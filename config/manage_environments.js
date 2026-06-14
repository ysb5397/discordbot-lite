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
        earthquakeNotice: required('EARTHQUAKE_NOTICE_CHANNEL_ID'),
        ignoreAiChat: required('IGNORE_AI_CHAT_CHANNEL_ID')
    },

    // 3. AI 설정 (무료 토큰 및 Flash 모델 최적화)
    ai: {
        geminiKey: required('GEMINI_API_KEY'),
        // 페르소나 설정 (네가 원하는 반말 모드!)
        persona: process.env.AI_PERSONA || `
            너는 사용자의 친한 친구이자 유능한 AI 비서야.
            말투는 항상 귀엽고 친근한 반말(해체)을 사용해.
            사용자를 부를 때는 '너' 또는 '네가'라고 지칭해.
            이모지를 적절히 사용해서 감정을 표현해줘.
            모르는 것이 있으면 솔직하게 모른다고 하고 같이 찾아보자고 제안해.
        `.trim()
    },

    // 4. 시스템 설정 (DB 제거됨 - 메모리 및 환경 변수 활용)
    system: { // 이 부분에 'system' 또는 'server'라는 키가 빠져있었어!
        port: process.env.PORT || 5500,
        jwtSecret: required('JWT_SECRET', 'default_secret_for_lite'), // Lite 버전이므로 기본값 허용 검토
        appUrl: process.env.APP_URL,
    },

    // 5. 지진 정보 API (기상청 공공데이터 등)
    etc: {
        earthquakeKey: required('EQK_AUTH_KEY'),
    }
};

module.exports = config;