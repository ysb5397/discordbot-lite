// utils/ai_helper.js - 무료 Gemini Flash 모델 전용

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logToDiscord } = require('../system/catch_log.js');
const fetch = require('node-fetch');
const config = require('../../config/manage_environments.js');

const GOOGLE_API_KEY = config.ai.geminiKey;
const SYSTEM_INSTRUCTION = config.ai.persona;

// Gemini 클라이언트 초기화
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

/**
 * 사용 가능한 모델 설정 (모두 무료 토큰)
 * - gemini-2.5-flash: 최신 Flash 모델, 높은 성능
 * - gemini-3-flash-preview: 최신 3.0 Flash 모델, 더 나은 성능
 */
const models = {
    'gemini-2.5-flash': genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: SYSTEM_INSTRUCTION
    }),
    'gemini-3-flash-preview': genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        systemInstruction: SYSTEM_INSTRUCTION
    })
};

// 임베딩 모델 (제거됨 - DB 미사용)

/**
 * 첨부 파일을 바이너리 데이터로 변환하여 Gemini 프롬프트 생성
 * @param {object} promptData - 질문 데이터
 * @param {string} promptData.question - 사용자 질문
 * @param {object} [attachment] - Discord 첨부 파일 객체
 * @returns {Promise<Array>} - Gemini 프롬프트 파트 배열
 * @throws {Error} 파일 다운로드 또는 처리 실패 시
 */
async function buildGeminiPrompt(promptData, attachment) {
    const parts = [];

    try {
        if (attachment) {
            // 파일 다운로드
            const response = await fetch(attachment.url, { timeout: 30000 });
            if (!response.ok) {
                throw new Error(`첨부파일 다운로드 실패 (HTTP ${response.status}): ${attachment.name}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const imageBuffer = Buffer.from(arrayBuffer);

            // MIME 타입 결정
            const mimeType = attachment.contentType || 'application/octet-stream';

            // 파일 크기 확인 (Gemini는 20MB 제한)
            const fileSizeMB = imageBuffer.length / (1024 * 1024);
            if (fileSizeMB > 20) {
                throw new Error(`파일 크기 초과 (${fileSizeMB.toFixed(2)}MB > 20MB): ${attachment.name}`);
            }

            // 이미지/파일 추가
            parts.push({
                inlineData: {
                    data: imageBuffer.toString('base64'),
                    mimeType: mimeType
                }
            });

            // 질문 추가
            parts.push({
                text: `${promptData.question}\n\n(첨부 파일: ${attachment.name})`
            });
        } else {
            // 텍스트만 추가
            parts.push({ text: promptData.question });
        }

        return parts;
    } catch (error) {
        console.error('[Prompt Builder] 오류:', error.message);
        throw new Error(`프롬프트 구성 실패: ${error.message}`);
    }
}

/**
 * Gemini 스트리밍 응답 생성 (무료 모델 전용, 폴백 없음)
 * @async
 * @generator
 * @param {object} promptData - 질문 데이터
 * @param {string} promptData.question - 사용자 질문
 * @param {object} [attachment] - Discord 첨부 파일
 * @param {string} sessionId - 세션 ID (로깅용)
 * @param {object} options - 옵션
 * @param {object} options.client - Discord 클라이언트
 * @param {object} options.interaction - Discord 인터랙션
 * @param {string} [options.task] - 작업 설명자
 * @param {string} modelName - 사용할 모델명 ('gemini-2.5-flash' 또는 'gemini-3-flash-preview')
 * @param {number} tokenLimit - 최대 출력 토큰 수
 * @yields {object} 스트리밍 결과 객체
 *   - {error: Error} - 오류 발생 시
 *   - {textChunk: string} - 텍스트 청크
 *   - {finalResponse: {text: string}} - 최종 응답
 */
async function* getChatResponseStreamOrFallback(
    promptData,
    attachment,
    sessionId,
    { client, interaction, task = 'chat' },
    modelName = 'gemini-2.5-flash',
    tokenLimit = 2048
) {
    let fullResponseText = '';
    let model;

    try {
        // 모델 선택 및 검증
        if (!modelName || !models[modelName]) {
            throw new Error(`지원하지 않는 모델: ${modelName}. 지원 모델: ${Object.keys(models).join(', ')}`);
        }

        model = models[modelName];
        console.log(`[AI Chat] 모델 선택: ${modelName}, 토큰 한도: ${tokenLimit}`);

        // 프롬프트 구성
        let currentPromptParts;
        try {
            currentPromptParts = await buildGeminiPrompt(promptData, attachment);
        } catch (promptError) {
            throw new Error(`프롬프트 구성 실패: ${promptError.message}`);
        }

        // 스트리밍 응답 생성
        console.log(`[AI Chat] Gemini 스트리밍 시작...`);
        
        const generationConfig = {
            maxOutputTokens: Math.max(100, Math.min(tokenLimit, 10000)),
            temperature: 0.7,
            topP: 0.95,
            topK: 40
        };

        const response = await model.generateContentStream(currentPromptParts, { generationConfig });

        // 스트리밍 처리
        for await (const chunk of response.stream) {
            try {
                if (chunk.text && chunk.text()) {
                    const chunkText = chunk.text();
                    fullResponseText += chunkText;
                    yield { textChunk: chunkText };
                }
            } catch (chunkError) {
                console.warn(`[AI Chat] 청크 처리 경고: ${chunkError.message}`);
                // 청크 오류는 무시하고 계속 진행
            }
        }

        console.log(`[AI Chat] Gemini 스트리밍 정상 종료. (${fullResponseText.length} 자)`);
        yield { finalResponse: { text: fullResponseText } };

    } catch (error) {
        console.error(`[AI Chat] 오류 발생:`, error.message);

        // Discord 로깅
        if (client) {
            try {
                await logToDiscord(
                    client,
                    'ERROR',
                    `AI 응답 생성 실패 (${task})`,
                    interaction,
                    error,
                    'getChatResponseStreamOrFallback'
                );
            } catch (logError) {
                console.warn(`[AI Chat] 로깅 실패: ${logError.message}`);
            }
        }

        // 사용자 친화적인 에러 메시지
        let userMessage = '아, 뭔가 잘못됐어... 😭 다시 시도해줄래?';
        
        if (error.message.includes('401') || error.message.includes('API key')) {
            userMessage = '⚙️ API 설정 문제가 있어요. 관리자한테 알려주세요!';
        } else if (error.message.includes('429')) {
            userMessage = '⏳ 지금 너무 바빠요... 잠깐 후에 다시 시도해주세요!';
        } else if (error.message.includes('파일 크기')) {
            userMessage = '📦 파일이 너무 커요... 20MB 이하로 올려주세요!';
        } else if (error.message.includes('타임아웃')) {
            userMessage = '⏱️ 응답이 너무 오래 걸렸어요... 다시 시도해주세요!';
        }

        yield {
            error: new Error(userMessage),
            technical: error.message
        };
    }
}

/**
 * 멘션 답변 (짧은 응답, 빠른 처리)
 * @async
 * @param {Array} history - 대화 히스토리
 * @param {string} userMessage - 사용자 메시지
 * @returns {Promise<string>} - AI 응답 텍스트
 * @throws {Error} 응답 생성 실패 시
 */
async function generateMentionReply(history, userMessage) {
    try {
        const model = models['gemini-3-flash-preview'];
        
        if (!model) {
            throw new Error('모델 초기화 실패');
        }

        const enhancedMessage = `${userMessage}

        (너는 사용자의 유능한 AI 비서야. 
        설명은 친절하게 해줘. 
        전문적인 내용이라도 쉽고 재미있게 풀어서 설명해줘. 
        상황에 맞춰서 유연하게 대답해줘)`;

        // 💡 [핵심 수정됨] startChat() 대신 generateContent() 사용!
        // 과거 대화 배열(history) 구조 때문에 SDK가 뻗는 문제를 원천 차단함.
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: enhancedMessage }] }],
            generationConfig: {
                temperature: 0.1
            }
        });
        
        if (!result.response || !result.response.text()) {
            throw new Error('빈 응답 받음');
        }

        return result.response.text();
    } catch (error) {
        console.error('[Mention Reply] 생성 실패:', error.message);
        throw new Error(`멘션 응답 생성 실패: ${error.message}`);
    }
}

module.exports = {
    getChatResponseStreamOrFallback,
    generateMentionReply
};