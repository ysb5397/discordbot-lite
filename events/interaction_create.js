// events/interactionCreate.js

const { Events } = require('discord.js');
const { logToDiscord } = require('../utils/system/catch_log.js');
const config = require('../config/manage_environments.js');

const ALLOWED_GUILD_ID = config.discord.guildId;
const OWNER_ID = config.discord.ownerId;

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (client.amIActive === false) {
            return;
        }

        let foundUser = null;
        try {
            if (interaction.user.id !== OWNER_ID) {
                foundUser = await WhiteList.findOne({ memberId: interaction.user.id });

                // 길드 외부이거나 화이트리스트가 아닌 경우 차단
                if (interaction.guildId !== ALLOWED_GUILD_ID && (!foundUser || !foundUser.isWhite)) {
                    return interaction.reply({
                        content: '이 봇은 승인된 서버 내부 또는 화이트 리스트 유저만 사용할 수 있습니다. 🔒',
                        ephemeral: true
                    }).catch(() => { });
                }
            }
        } catch (dbErr) {
            console.error('화이트리스트 조회 실패:', dbErr);
            return interaction.reply({ content: '데이터베이스 오류로 권한을 확인할 수 없습니다.', ephemeral: true }).catch(() => { });
        }

        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`'${interaction.commandName}'에 해당하는 명령어를 찾을 수 없습니다.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}`);

            await logToDiscord(client, 'ERROR', `/${interaction.commandName} 명령어 실행 중 오류 발생`, interaction, error);

            try {
                if (error.code === 10062 || error.code === 40060) {
                    console.warn('상호작용이 이미 만료되었거나 알 수 없어 유저에게 응답하지 않습니다.');
                    return;
                }

                const errorMsg = { content: '명령어 실행 중 오류가 발생했습니다! 😢', ephemeral: true };

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMsg);
                } else {
                    await interaction.reply(errorMsg);
                }
            } catch (replyError) {
                console.warn(`[Safety Catch] 유저에게 에러 알림 전송 실패 (무시됨): ${replyError.message}`);
            }
        }
    },
};