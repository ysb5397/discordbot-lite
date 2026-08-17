// utils/embed_builder.js

const { EmbedBuilder } = require('discord.js');

/**
 * 기본 Embed 틀을 생성하는 내부 헬퍼 함수
 * @param {object} options - 기본 Embed 옵션
 * @param {string} [options.title] - 제목
 * @param {string} [options.description] - 설명
 * @param {number} [options.color] - 색상
 * @param {string} [options.footerText] - Footer 텍스트 (타임스탬프 자동 추가됨)
 * @param {string} [options.imageUrl] - 이미지 URL
 * @param {Array<object>} [options.fields] - 필드 배열 ( [{ name: '...', value: '...', inline?: boolean }] )
 * @returns {EmbedBuilder} - 기본 설정된 EmbedBuilder 인스턴스
 */
function createBaseEmbed({ title, description, color, footerText, imageUrl, fields }) {
    const embed = new EmbedBuilder();

    if (title) embed.setTitle(title.substring(0, 256)); // 제목 길이 제한
    if (description) embed.setDescription(description.substring(0, 4096)); // 설명 길이 제한
    if (color) embed.setColor(color);
    if (imageUrl) embed.setImage(imageUrl);
    if (fields && Array.isArray(fields)) {
        // 필드 값 길이 제한 적용
        const limitedFields = fields.map(f => ({
            name: String(f.name).substring(0, 256),
            value: String(f.value).substring(0, 1024),
            inline: f.inline || false
        }));
        embed.addFields(limitedFields.slice(0, 25)); // 최대 25개 필드
    }

    embed.setTimestamp(); // 타임스탬프는 기본으로 추가

    if (footerText) {
        embed.setFooter({ text: String(footerText).substring(0, 2048) });
    }

    return embed;
}

/**
 * 일반적인 AI 명령어 응답 Embed 생성 (chat, deep_research 등)
 * @param {object} data - Embed 데이터
 * @param {string} [data.title] - 사용자 질문/프롬프트
 * @param {string} data.description - AI의 답변 내용
 * @param {Array<object>} [data.fields] - 추가 필드 (예: 출처)
 * @param {string} [data.footerPrefix="Powered by AI"] - Footer 앞부분 텍스트
 * @param {number} [data.duration] - 명령어 실행 시간 (밀리초)
 * @param {import('discord.js').User} [data.user] - 요청 사용자 객체
 * @param {boolean} [data.isFallback=false] - Gemini 폴백 응답 여부
 * @param {string} [data.searchQuery] - (Deep Research) 사용된 검색어
 * @returns {EmbedBuilder}
 */
function createAiResponseEmbed({ title, description, fields, footerPrefix = "Powered by AI", duration, user, isFallback = false, searchQuery }) {
    const color = isFallback ? COLORS.WARN : COLORS.SUCCESS;
    let footerText = footerPrefix;

    if (duration !== undefined) {
        const durationString = (duration / 1000).toFixed(1) + 's';
        footerText += ` | ${durationString} 소요`;
    }
    if (searchQuery) {
        footerText += ` | 검색어: "${searchQuery}"`;
    }
    if (user) {
        footerText += ` | 요청자: ${user.tag}`;
    }

    return createBaseEmbed({ title, description, fields, color, footerText });
}

/**
 * 로그 메시지 Embed 생성
 * @param {object} data
 * @param {string} data.errorMessage - 보여줄 오류 메시지
 * @param {string} [data.commandName] - 오류가 발생한 명령어 이름 (선택)
 * @param {import('discord.js').User} [data.user] - 요청 사용자 (선택)
 * @param {string} data.type - 로그 유형 (예: 'ERROR', 'WARN')
 * @returns {EmbedBuilder}
 */
function createLogEmbed({ message, commandName, user, type }) {
    const color = type === 'ERROR' ? COLORS.ERROR : (type === 'WARN' ? COLORS.WARN : COLORS.INFO);
    let title = type === 'ERROR' ? '❌ 오류 발생' : (type === 'WARN' ? '⚠️ 경고' : 'ℹ️ 정보');

    if (commandName) {
        title += ` (${commandName})`;
    }

    return createBaseEmbed({
        title,
        description: message,
        color,
        footerText: user ? `요청자: ${user.tag}` : undefined
    });
}


// 필요한 함수들을 export
module.exports = {
    createBaseEmbed,
    createAiResponseEmbed,
    createLogEmbed
};