const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const config = require('./config/manage_environments.js');

const DISCORD_BOT_TOKEN = config.discord.token;
const DISCORD_CLIENT_ID = config.discord.clientId;
const DISCORD_GUILD_ID = config.discord.guildId;

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

/**
 * 모든 파일을 재귀적으로 탐색하는 헬퍼 함수
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;

    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            getAllFiles(fullPath, arrayOfFiles);
        } else if (file.endsWith('.js')) {
            arrayOfFiles.push(fullPath);
        }
    });

    return arrayOfFiles;
}

/**
 * 글로벌 명령어를 등록 (index.js에서 호출)
 */
async function registerGlobalCommands() {
    if (!DISCORD_CLIENT_ID) {
        throw new Error('CLIENT_ID가 설정되지 않았습니다.');
    }

    try {
        console.log(`(/) 글로벌 명령어 등록 프로세스 시작...`);
        await loadAndRegisterCommands();
    } catch (error) {
        console.error('(/) 글로벌 명령어 등록 실패:', error);
        throw error;
    }
}

/**
 * 글로벌 및 길드 명령어 전체 삭제 (수동 관리용)
 */
async function cleanAllCommands() {
    if (!DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
        console.error('오류: .env 파일에 DISCORD_CLIENT_ID와 DISCORD_GUILD_ID가 모두 필요합니다.');
        return;
    }
    try {
        console.log('(/) 모든 [글로벌] 명령어 청소 중...');
        await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: [] });

        console.log(`(/) '${DISCORD_GUILD_ID}' 서버의 [길드] 명령어 청소 중...`);
        await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: [] });

        console.log('✅ 모든 기존 명령어 청소 완료.');
    } catch (error) {
        console.error('(/) 명령어 청소 중 오류 발생:', error);
    }
}

/**
 * 파일을 로드하고 Discord API에 등록
 */
async function loadAndRegisterCommands() {
    const commands = [];
    const commandsPath = path.join(__dirname, 'commands');

    const commandFiles = getAllFiles(commandsPath);

    for (const filePath of commandFiles) {
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        } else {
            console.log(`[경고] ${filePath} 명령어에 "data" 또는 "execute"가 없습니다.`);
        }
    }

    if (commands.length === 0) {
        console.log('(/) 등록할 명령어가 없습니다.');
        return;
    }

    console.log(`(/) ${commands.length}개의 명령어를 [글로벌]로 등록 시도 중...`);
    await rest.put(
        Routes.applicationCommands(DISCORD_CLIENT_ID),
        { body: commands },
    );
    console.log(`(/) ${commands.length}개의 [글로벌] 명령어 등록 성공!`);
}

// 모듈 내보내기
module.exports = { registerGlobalCommands };

// --- 수동 실행 모드 (node deploy-commands.js) ---
if (require.main === module) {
    (async () => {
        try {
            console.log('[수동 스크립트 실행 모드]');
            // Lite 버전이므로 DB 연결 없이 바로 실행
            await cleanAllCommands();
            await loadAndRegisterCommands();
            console.log('✨ 모든 작업이 성공적으로 완료되었습니다.');
            process.exit(0);
        } catch (e) {
            console.error('❌ 작업 중 에러 발생:', e);
            process.exit(1);
        }
    })();
}