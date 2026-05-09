// index.js
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const config = require('./config/manage_environments.js');
const { logToDiscord } = require('./utils/system/catch_log');
const { registerGlobalCommands } = require('./deploy-commands.js');

// --- 1. 클라이언트 초기화 ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

// 봇의 활성화 상태 제어용 플래그
client.amIActive = true;

// --- 2. 오류 핸들링 (치명적 오류 대응) ---
process.on('uncaughtException', async (error, origin) => {
    console.error('!!! 치명적인 예외 발생 (Uncaught Exception) !!!', error);
    try {
        if (client.isReady()) {
            await logToDiscord(client, 'ERROR', '처리되지 않은 치명적인 예외가 발생했습니다!', null, error, origin);
        }
    } catch (loggingError) {
        console.error('에러 로깅 중 추가 오류 발생:', loggingError);
    } finally {
        console.log('프로세스를 안전하게 종료합니다.');
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('!!! 처리되지 않은 Promise 거부 (Unhandled Rejection) !!!', reason);
    const error = (reason instanceof Error) ? reason : new Error(String(reason));
    if (client.isReady()) {
        logToDiscord(client, 'ERROR', '처리되지 않은 Promise 거부가 발생했습니다!', null, error, 'unhandledRejection');
    }
});

// --- 3. 파일 재귀 탐색 함수 (커맨드/이벤트 로드용) ---
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

// --- 4. 명령어 및 이벤트 로드 ---
client.commands = new Collection();

// 명령어 로드
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = getAllFiles(commandsPath);

for (const filePath of commandFiles) {
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.warn(`[경고] ${filePath} 명령어에 "data" 또는 "execute" 속성이 누락되었습니다.`);
    }
}

// 이벤트 로드
const eventsPath = path.join(__dirname, 'events');
const eventFiles = getAllFiles(eventsPath);

for (const filePath of eventFiles) {
    const event = require(filePath);
    if (event.name) {
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    }
}

// --- 5. 메인 실행 함수 ---
const startBot = async () => {
    try {
        // 봇 로그인
        await client.login(config.discord.token);
        console.log(`✅ ${client.user.tag} 로그인 및 준비 완료!`);

        // 글로벌 명령어 등록 (Git 버전 정보인 commitSha 로직 제거)
        console.log('🔄 글로벌 명령어 등록을 시작합니다...');
        await registerGlobalCommands(); 
        console.log('✅ 글로벌 명령어 등록 완료!');

    } catch (error) {
        console.error("!!! 봇 시작 중 치명적인 오류 발생 !!!", error);
        process.exit(1);
    }
};

startBot();