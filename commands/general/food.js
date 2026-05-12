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
                .setDescription('학식 데이터를 최신 상태로 동기화합니다. (하루 1회 제한)')
        ),

    async execute(interaction) {
        // 크롤링 등 시간이 걸릴 수 있으므로 deferReply 먼저 호출
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand(false) || 'now';

        // 1. 동기화 명령어 처리 (/food refresh)
        if (subcommand === 'refresh') {
            try {
                const result = await syncFoodData(true); // true = 수동 동기화 모드
                return interaction.followUp(result.message);
            } catch (err) {
                return interaction.followUp("❌ 크롤링 중 오류가 발생했습니다. 나중에 다시 시도해주세요.");
            }
        }

        // 2. 식단 조회 로직 (/food now 또는 그냥 /food)
        // 현재 시간에 맞춰서 조식, 중식, 석식 중 무엇을 보여줄지 결정
        const { dateString, type, typeName } = getCurrentMealInfo();
        
        // 데이터에서 해당 식단 가져오기
        const menuString = getMenu(dateString, type);

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71) // 먹음직스러운 초록/연두색 계열
            .setTitle(`🍽️ 오늘의 학식 (${typeName})`)
            .setDescription(`**[${dateString}]**\n\n${menuString}`)
            .setFooter({ text: '데이터 동기화가 필요하면 /food refresh를 사용하세요.' });

        await interaction.followUp({ embeds: [embed] });
    },
};