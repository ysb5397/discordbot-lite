const { Events, ChannelType, ActivityType } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const config = require('../config/manage_environments');

const TARGET_CHANNEL_ID = config.channels.autoJoin;
const IS_DEV_BOT = config.discord.isDevBot;

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`${client.user.tag}으로 로그인했습니다.`);
        console.log('봇이 준비되었으며 백그라운드 작업을 시작합니다.');

        setTimeout(() => {
            try {
                client.user.setPresence({
                    status: 'online',
                    activities: [{
                        name: 'Gemini',
                        type: ActivityType.Playing,
                        timestamps: { start: Date.now() },
                    }],
                });
                console.log('봇의 "Playing" 상태 메시지를 성공적으로 설정했습니다.');
            } catch (error) {
                console.error('봇 상태 메시지 설정 중 오류 발생:', error);
            }
        }, 5000);

        const targetChannel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
        if (targetChannel && targetChannel.type === ChannelType.GuildVoice) {
            const humanMembers = targetChannel.members.filter(member => !member.user.bot);
            if (humanMembers.size > 0) {
                console.log(`'${targetChannel.name}' 채널에 이미 유저가 있어 접속합니다!`);
                joinVoiceChannel({
                    channelId: targetChannel.id,
                    guildId: targetChannel.guild.id,
                    adapterCreator: targetChannel.guild.voiceAdapterCreator,
                });
            }
        }
    },
};