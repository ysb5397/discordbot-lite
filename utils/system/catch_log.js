const { Client, Interaction: DiscordInteraction } = require('discord.js');
const { createLogEmbed } = require('../ui/embed_builder.js');
const config = require('../../config/manage_environments.js');

const LOG_CHANNEL_ID = config.discord.logChannelId;

// 로그 레벨별 색상 및 이모지 정의
const LogLevel = {
    INFO: { color: 0x3498DB, emoji: 'ℹ️', titlePrefix: '정보' },
    DEBUG: { color: 0x2ECC71, emoji: '🐛', titlePrefix: '디버그' },
    WARN: { color: 0xF1C40F, emoji: '⚠️', titlePrefix: '경고' },
    ERROR: { color: 0xE74C3C, emoji: '🚨', titlePrefix: '에러 발생' },
};

async function logToDiscord(client, level, message, interaction = null, error = null, origin = null) {
    const levelInfo = LogLevel[level] || LogLevel.INFO;

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

    // [Lite 버전 수정] 기존 DB에 에러를 백업하던 로직(Interaction.create)을 완전히 삭제했어.
    // Lite 버전은 DB가 없으므로 파일이나 디스코드 로그 채널에만 의존해야 해.

    if (!LOG_CHANNEL_ID) {
        console.warn('[Logger] DISCORD_LOG_CHANNEL_ID가 설정되지 않아 디스코드 로깅을 건너뜁니다.');
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
        } else if (origin) {
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