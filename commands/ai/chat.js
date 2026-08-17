// commands/ai/chat.js
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { getChatResponseStreamOrFallback } = require('../../utils/ai/ai_helper.js');
const { logToDiscord } = require('../../utils/system/catch_log.js');
const { createAiResponseEmbed } = require('../../utils/ui/embed_builder.js');

async function handleRegularConversation(interaction, startTime, selectedModel, tokenLimit) {
    const client = interaction.client;
    const userQuestion = interaction.options.getString('question');
    const sessionId = interaction.user.id;
    const attachment = interaction.options.getAttachment('file');

    let promptData = { question: userQuestion };
    let footerInfo = ['Local AI (Luna)'];

    let fullResponseText = "";
    let finalMessage = null;
    let isFallback = false;
    let finalError = null;

    // 디스코드 API 제한 방어
    let lastUpdateTime = 0;
    const updateInterval = 1800; 
    let currentEmbed = null;

    const debouncedUpdate = async (isFinal = false) => {
        const now = Date.now();
        if (!isFinal && now - lastUpdateTime < updateInterval) return;
        lastUpdateTime = now;

        const duration = now - startTime;
        const isStreaming = !isFinal && !finalError;

        let description = fullResponseText.substring(0, 4090) + (isStreaming ? "..." : "");
        if (finalMessage) description += `\n\n${finalMessage}`;

        const footerPrefix = `Powered by AI ${footerInfo.length > 0 ? `(${footerInfo.join(', ')})` : ''}`;

        currentEmbed = createAiResponseEmbed({
            title: userQuestion.substring(0, 250) + (userQuestion.length > 250 ? '...' : ''),
            description: description,
            duration: duration,
            user: interaction.user,
            isFallback: isFallback,
            imageUrl: attachment ? attachment.url : undefined,
            footerPrefix: footerPrefix
        });

        try {
            await interaction.editReply({
                content: `<@${sessionId}>${isStreaming ? ' 타이핑 중... ⌨️' : ''}`,
                embeds: [currentEmbed]
            });
        } catch (editError) {
            console.error('[/chat] 스트리밍 중 editReply 실패:', editError);
            logToDiscord(client, 'WARN', '스트리밍 응답 업데이트 실패', interaction, editError, 'handleRegularConversation_StreamUpdate');
            finalError = editError;
        }
    };

    try {
        const stream = getChatResponseStreamOrFallback(promptData, attachment, sessionId, { client, interaction, task: 'chat' }, selectedModel, tokenLimit);

        for await (const result of stream) {
            if (result.error) {
                finalError = result.error;
                break;
            }
            if (result.textChunk) {
                fullResponseText += result.textChunk;
                await debouncedUpdate(false);
            }
            if (result.finalResponse) {
                fullResponseText = result.finalResponse.text;
                finalMessage = result.finalResponse.message;
                isFallback = result.isFallback ?? false;
                break;
            }
        }

        if (finalError) {
            throw finalError;
        } else {
            await debouncedUpdate(true);
        }

    } catch (error) {
        console.error('[/chat] 최종 에러:', error);
        throw error;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('똑똑한 전용 비서 루나(Luna)와 대화합니다.')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ])
        .addStringOption(option =>
            option.setName('model')
                .setDescription('사용할 AI 모델을 선택합니다.')
                .setRequired(true)
                .addChoices(
                    { name: '루나 (Local AI)', value: 'my_luna' }
                ))
        .addStringOption(option =>
            option.setName('question')
                .setDescription('루나에게 할 질문')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('token_limit')
                .setDescription('AI 응답의 최대 길이를 설정합니다. (기본: 2048)')
                .setRequired(false)
                .setMinValue(100)
                .setMaxValue(10000))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('파일을 첨부하세요 (로컬 AI는 현재 파일 이름만 참고합니다).')
                .setRequired(false)),

    async execute(interaction) {
        const startTime = Date.now();
        await interaction.deferReply();

        // 3. 기본값 my_luna
        const selectedModel = interaction.options.getString('model') || 'my_luna';
        const tokenLimit = interaction.options.getInteger('token_limit') || 2048;

        try {
            await handleRegularConversation(interaction, startTime, selectedModel, tokenLimit);
        } catch (error) {
            console.error('[/chat] 최종 처리 오류:', error);
            const errorMsg = error.message || '알 수 없는 오류가 발생했습니다.';
            
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply({ content: `❌ ${errorMsg}` });
                } else {
                    await interaction.reply({ content: `❌ ${errorMsg}`, ephemeral: true });
                }
            } catch (replyError) {
                console.warn('[/chat] 에러 응답 전송 실패:', replyError);
            }
        }
    },
};