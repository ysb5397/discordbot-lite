// 파일 위치: /utils/logger.js
const { Client, Interaction: DiscordInteraction } = require('discord.js');
const { createLogEmbed } = require('../ui/embed_builder.js');
const config = require('../../config/manage_environments.js');

const LOG_CHANNEL_ID = config.discord.logChannelId;

// 로그 레벨별 색상 및 이모지 정의
const LogLevel = {
    INFO: { color: 0x3498DB, emoji: 'ℹ️', titlePrefix: '정보' },      // 파란색
    DEBUG: { color: 0x2ECC71, emoji: '🐛', titlePrefix: '디버그' },    // 초록색
    WARN: { color: 0xF1C40F, emoji: '⚠️', titlePrefix: '경고' },      // 노란색
    ERROR: { color: 0xE74C3C, emoji: '🚨', titlePrefix: '에러 발생' }, // 빨간색
};

/**
 * 지정된 디스코드 로그 채널 및 콘솔에 로그를 기록합니다.
 *
 * @param {Client} client - 봇 클라이언트 인스턴스
 * @param {'INFO' | 'DEBUG' | 'WARN' | 'ERROR'} level - 로그 레벨 (LogLevel 객체의 키 중 하나)
 * @param {string} message - 기록할 주 메시지 내용
 * @param {DiscordInteraction | null} [interaction=null] - (선택) 로그와 관련된 상호작용 객체
 * @param {Error | null} [error=null] - (선택) 기록할 에러 객체 (주로 ERROR 레벨에서 사용)
 * @param {string | null} [origin=null] - (선택) 에러 발생 출처 (interaction 없을 때 유용)
 */
async function logToDiscord(client, level, message, interaction = null, error = null, origin = null) {
    const levelInfo = LogLevel[level] || LogLevel.INFO; // 유효하지 않은 레벨이면 INFO로 기본 설정

    // --- 1. 콘솔에도 로그 남기기 ---
    const consoleTimestamp = new Date().toLocaleString('ko-KR');
    let consoleMessage = `[${consoleTimestamp}] [${level}] ${message}`;
    if (interaction) {
        consoleMessage += ` (User: ${interaction.user.tag}, Guild: ${interaction.guild?.name})`;
    } else if (origin) {
        consoleMessage += ` (Origin: ${origin})`;
    }

    switch (level) {
        case 'ERROR':
            console.error(consoleMessage, error || '');
            break;
        case 'WARN':
            console.warn(consoleMessage);
            break;
        case 'DEBUG':
            console.debug(consoleMessage);
            break;
        default:
            console.log(consoleMessage);
    }

    if (level === 'ERROR' && error) {
        try {
            await Interaction.create({
                interactionId: `error-${Date.now()}`,
                channelId: interaction?.channelId || 'unknown',
                userId: interaction?.user?.id || client.user.id,
                userName: interaction?.user?.username || 'System',
                type: 'ERROR',
                content: {
                    message: message,
                    errorMessage: error.message,
                    stack: error.stack,
                    origin: origin
                },
                botResponse: 'Unresolved'
            });
            console.log('✅ [Logger] 에러 정보를 DB에 백업했습니다.');
        } catch (dbErr) {
            console.error('❌ [Logger] 에러 DB 저장 실패:', dbErr);
        }
    }

    if (!LOG_CHANNEL_ID) {
        console.warn('[Logger] DISCORD_LOG_CHANNEL_ID가 설정되지 않아 디스코드 로깅을 건너<0xEB><0x9B><0x81>니다.');
        return;
    }

    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
            console.error(`[Logger] 로그 채널(ID: ${LOG_CHANNEL_ID})을 찾을 수 없거나 텍스트 채널이 아닙니다.`);
            return;
        }

        const embed = createLogEmbed({ message, commandName: interaction?.commandName, user: interaction?.user, type: level });

        if (error) {
            embed.addFields([{
                name: 'Error Details',
                value: '```' + (error.stack || error.message).substring(0, 1000) + '```'
            }]);
        }

        if (interaction) {
            const commandName = interaction.isCommand() ? `/${interaction.commandName}` : 'N/A';
            embed.addFields([
                { name: '👤 User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                { name: '📍 Guild', value: `${interaction.guild?.name || 'DM'}`, inline: true },
                { name: '💬 Command', value: commandName, inline: true }
            ]);

            if (level === 'ERROR' && interaction.isCommand()) {
                embed.setTitle(`${levelInfo.emoji} ${levelInfo.titlePrefix}: ${commandName}`);
            }
        }

        else if (origin) {
            embed.addFields([{ name: '💥 Origin', value: String(origin), inline: true }]);
        }

        await channel.send({ embeds: [embed] });

    } catch (loggingError) {
        console.error('!!! [Logger] 디스코드 로그 전송 실패 !!!', loggingError);
        if (error) console.error('!!! [Logger] 원본 에러 !!!', error);
        else console.error('!!! [Logger] 원본 메시지 !!!', message);
    }
}

module.exports = { logToDiscord, LogLevel };