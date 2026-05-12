const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { syncFoodData, getMenu, getCurrentMealInfo } = require('../../utils/system/food_manager.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('food')
        .setDescription('폴리텍 부산캠퍼스의 현재 시간대 식단표를 알려줍니다.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('now')
                .setDescription('현재 시간대에 맞는 식단(조/중/석식)을 자동으로 알려줍니다.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('refresh')
                .setDescription('학식 데이터를 최신 상태로 동기화합니다. (일반 유저 1일 1회, 관리자 10분 1회)')
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand(false) || 'now';

        // 1. 동기화 명령어 처리 (/food refresh)
        if (subcommand === 'refresh') {
            try {
                // 💡 [수정됨] 상호작용을 발생시킨 유저의 ID를 매개변수로 넘겨줍니다.
                const result = await syncFoodData(true, interaction.user.id);
                return interaction.followUp(result.message);
            } catch (err) {
                return interaction.followUp("❌ 크롤링 중 오류가 발생했습니다. 나중에 다시 시도해주세요.");
            }
        }

        // 2. 식단 조회 로직 (/food now 또는 그냥 /food)
        const { dateString, type, typeName } = getCurrentMealInfo();
        
        const menuString = getMenu(dateString, type);

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71) 
            .setTitle(`🍽️ 오늘의 학식 (${typeName})`)
            .setDescription(`**[${dateString}]**\n\n${menuString}`)
            .setFooter({ text: '데이터 동기화가 필요하면 /food refresh를 사용하세요.' });

        await interaction.followUp({ embeds: [embed] });
    },
};