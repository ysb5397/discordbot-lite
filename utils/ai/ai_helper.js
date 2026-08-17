// utils/ai_helper.js
const { logToDiscord } = require('../system/catch_log.js');
const fetch = require('node-fetch');
const config = require('../../config/manage_environments.js');

// Ollama 설정 불러오기
const OLLAMA_URL = config.ai.ollamaUrl;
const MODEL_NAME = config.ai.modelName;
const SYSTEM_INSTRUCTION = config.ai.persona;

/**
 * Qwen(루나)은 텍스트 전용 모델
 * 첨부파일이 있으면 그냥 파일 이름만 질문에 합쳐주는 식으로 아주 가볍게 처리
 */
function buildOllamaPrompt(promptData, attachment) {
    let finalQuestion = promptData.question;
    if (attachment) {
        finalQuestion += `\n\n(참고: 사용자가 '${attachment.name}' 파일을 첨부했습니다.)`;
    }
    return finalQuestion;
}

/**
 * Ollama 스트리밍 응답 생성 (실시간 타자기 효과)
 * @async
 * @generator
 */
async function* getChatResponseStreamOrFallback(
    promptData,
    attachment,
    sessionId,
    { client, interaction, task = 'chat' }
) {
    let fullResponseText = '';

    try {
        console.log(`[AI Chat] 로컬 AI(${MODEL_NAME}) 스트리밍 시작...`);

        // 질문 텍스트 정리 (첨부파일 이름 포함)
        const userQuestion = buildOllamaPrompt(promptData, attachment);

        // Ollama 규격에 맞는 메시지 배열 생성
        const messages = [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: userQuestion }
        ];

        // Ollama API로 POST 요청 (stream: true)
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: messages,
                stream: true, // 실시간 스트리밍 켜기
                options: {
                    temperature: 0.7,
                    top_p: 0.95
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama 서버 오류 (HTTP ${response.status})`);
        }

        // 💡 스트리밍 데이터(JSONL)를 쪼개서 읽어들이는 로직
        let buffer = '';
        for await (const chunk of response.body) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 아직 덜 끝난 문장은 버퍼에 남기기

            for (const line of lines) {
                if (line.trim() === '') continue;
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.message && parsed.message.content) {
                        const chunkText = parsed.message.content;
                        fullResponseText += chunkText;
                        yield { textChunk: chunkText }; // 디스코드로 한 글자씩 쏘기
                    }
                } catch (parseError) {
                    console.warn(`[AI Chat] 청크 파싱 경고: ${parseError.message}`);
                }
            }
        }

        console.log(`[AI Chat] 로컬 AI 스트리밍 정상 종료. (${fullResponseText.length} 자)`);
        yield { finalResponse: { text: fullResponseText } };

    } catch (error) {
        console.error(`[AI Chat] 오류 발생:`, error.message);

        // Discord 로깅
        if (client) {
            try {
                await logToDiscord(
                    client, 'ERROR', `AI 응답 생성 실패 (${task})`, interaction, error, 'getChatResponseStreamOrFallback'
                );
            } catch (logError) {
                console.warn(`[AI Chat] 로깅 실패: ${logError.message}`);
            }
        }

        // 통신 오류
        yield {
            error: new Error('앗, 서버가 좀 아픈 것 같아요! 😵 (로컬 AI 서버가 꺼져있거나 연결할 수 없어요)'),
            technical: error.message
        };
    }
}

/**
 * 멘션 답변 (스트리밍 없이 한 번에 응답하는 빠른 처리)
 * @async
 */
async function generateMentionReply(history, userMessage) {
    try {
        console.log(`[Mention Reply] 로컬 AI(${MODEL_NAME}) 멘션 응답 시작...`);
        
        const messages = [
            { role: 'system', content: SYSTEM_INSTRUCTION }
        ];

        // 과거 대화 기록(history) 변환 (제미나이 형식이 넘어올 수 있으니 Ollama 형식으로 교정)
        if (history && Array.isArray(history)) {
            history.forEach(msg => {
                const role = (msg.role === 'model' || msg.role === 'assistant') ? 'assistant' : 'user';
                const content = msg.parts ? msg.parts[0].text : (msg.content || '');
                messages.push({ role, content });
            });
        }

        messages.push({ role: 'user', content: userMessage });

        // 스트리밍 없이(stream: false) 한 방에 요청
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: messages,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama 서버 오류 (HTTP ${response.status})`);
        }

        const data = await response.json();
        return data.message.content;

    } catch (error) {
        console.error('[Mention Reply] 생성 실패:', error.message);
        throw new Error(`멘션 응답 생성 실패: ${error.message}`);
    }
}

module.exports = {
    getChatResponseStreamOrFallback,
    generateMentionReply
};