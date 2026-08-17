require('dotenv').config();

// 필수 환경 변수가 있는지 확인하는 헬퍼 함수
function required(key, defaultValue = undefined) {
    const value = process.env[key] || defaultValue;
    if (value == null) {
        throw new Error(`❌ [설정 오류] 필수 환경 변수가 누락되었습니다: ${key}`);
    }
    return value;
}

const config = {
    // 1. 디스코드 기본 설정
    discord: {
        token: required('DISCORD_BOT_TOKEN'),
        clientId: required('DISCORD_CLIENT_ID'),
        guildId: required('DISCORD_GUILD_ID'),
        logChannelId: required('DISCORD_LOG_CHANNEL_ID'),
        ownerId: required('OWNER_ID'),
        baseMemberRoleId: required('BASE_MEMBER_ROLE_ID'),
        isDevBot: required('IS_DEV_BOT', 'false'), // 기본값 설정으로 안정성 강화
    },

    // 2. 채널 ID 모음
    channels: {
        ignoreAiChat: required('IGNORE_AI_CHAT_CHANNEL_ID')
    },

    // 3. AI 설정 (Ollama 로컬 AI로 교체)
    ai: {
        ollamaUrl: required('OLLAMA_URL', 'http://127.0.0.1:11434/api/chat'), 
        
        // 모델 이름
        modelName: required('AI_MODEL_NAME', 'my_luna'), 
        
        // 루나의 정체성을 완벽하게 박아버리는 시스템 프롬프트로 기본값 변경
        persona: process.env.AI_PERSONA || `너는 똑똑하고 센스 있는 사용자 전용 AI 비서 루나(Luna)야. 기계적인 번역투나 딱딱한 말투는 절대 피하고, 자연스럽고 친절한 한국어 반말로 대답해. 사용자가 묻는 말에 핵심만 명쾌하게 답변하며, 적절한 이모지를 사용해서 대화해줘.`
    },

    // 4. 시스템 설정
    system: {
        port: process.env.PORT || 5500,
        jwtSecret: required('JWT_SECRET', 'default_secret_for_lite'), // Lite 버전이므로 기본값 허용 검토
        appUrl: process.env.APP_URL,
    }
};

module.exports = config;