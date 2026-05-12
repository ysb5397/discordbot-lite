const { Events } = require('discord.js');
const { logToDiscord } = require('../utils/system/catch_log.js');
const config = require('../config/manage_environments.js');
const queueManager = require('../utils/system/queue_manager.js'); // 대기열 매니저 불러오기

const ALLOWED_GUILD_ID = config.discord.guildId;

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (client.amIActive === false) {
            return;
        }

        // 1. 대기열(슬롯) 검사
        // 관리자가 아니면서 동시에 3명이 이미 봇을 쓰고 있다면 차단
        if (!queueManager.canProcess(interaction.user.id)) {
            return interaction.reply({
                content: '⏳ 현재 봇이 대기열 마감(최대 3명) 상태입니다. 다른 작업이 끝난 후 잠시 뒤에 다시 시도해주세요!',
                ephemeral: true
            }).catch(() => { });
        }

        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`'${interaction.commandName}'에 해당하는 명령어를 찾을 수 없습니다.`);
            return;
        }

        // 2. 대기열 입장 (슬롯 차지)
        queueManager.enter(interaction.user.id);

        try {
            // 3. 실제 명령어 실행
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
        } finally {
            // 4. 대기열 퇴장 (명령어가 성공하든 에러가 나든 무조건 슬롯을 반환해야 함)
            queueManager.leave(interaction.user.id);
        }
    },
};