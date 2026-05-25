const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getMenu, syncFoodData, getTodayString, getKstDate, getNextWeekDateString, getCurrentMealInfo } = require('../../utils/system/food_manager.js');
const { saveMemberFoodPreference, getMemberFoodPreference } = require('../../utils/system/member_food_reference_manager.js');

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
                .addIntegerOption(option =>
                    option.setName('day')
                        .setDescription('동기화할 날짜를 선택하세요. 예시 - yyyyMMdd (선택하지 않으면 오늘 날짜로 동기화)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reference')
                .setDescription('개인 식단 선호도를 설정하거나 조회합니다. (예: /food reference like:베이컨, /food reference)')
                .addStringOption(option =>
                    option.setName('like')
                        .setDescription('좋아하는 음식을 입력하세요. (예: 베이컨, 치킨)')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('dislike')
                        .setDescription('싫어하는 음식을 입력하세요. (예: 버섯, 고수)')
                        .setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('reset')
                        .setDescription('선호도 초기화 여부 (true로 설정하면 좋아하는 음식과 싫어하는 음식 모두 초기화)')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand(false) || 'now';
        const dayOption = interaction.options.getInteger('day');

        const { dateString, type, typeName, isNextWeek } = getCurrentMealInfo();

        const targetDateStr = dayOption ? dayOption.toString() : getNextWeekDateString();

        // 1. 동기화 명령어 처리 (/food refresh)
        if (subcommand === 'refresh') {
            try {
                const syncDate = dayOption ? targetDateStr : (isNextWeek ? targetDateStr : null);
                const result = await syncFoodData(true, interaction.user.id, syncDate);
                return interaction.followUp(result.message);
            } catch (err) {
                console.error('❌ [Food Command] 동기화 중 에러:', err);
                return interaction.followUp("❌ 크롤링 중 오류가 발생했습니다. 나중에 다시 시도해주세요.");
            }
        }

        // 2. 식단 조회 로직
        if (subcommand === 'now') {
            let menuString = getMenu(dateString, type);

            let breakfast = getMenu(dateString, 'breakfast');
            let lunch = getMenu(dateString, 'lunch');

            if (breakfast === "등록된 식단이 없습니다." && lunch === "등록된 식단이 없습니다.") {
                await syncFoodData(false, interaction.user.id, isNextWeek ? dateString : null);
                
                // 동기화 후 다시 해당 타입의 메뉴를 가져옴
                menuString = getMenu(dateString, type);
            }

            const embed = new EmbedBuilder()
                .setColor(0x2ECC71) 
                .setTitle(`🍽️ 학식 안내 (${typeName})`)
                .setDescription(`**[${dateString}]**\n\n${menuString}`)
                .setFooter({ text: '데이터 동기화가 필요하면 /food refresh를 사용하세요.' });

            await interaction.followUp({ embeds: [embed] });
        }

        // 3. 개인 식단 선호도 처리 (/food reference)
        if (subcommand === 'reference') {
            const like = interaction.options.getString('like');
            const dislike = interaction.options.getString('dislike');
            const reset = interaction.options.getBoolean('reset');
            const displayName = interaction.member?.displayName || interaction.user.displayName;

            if (reset === true) {
                saveMemberFoodPreference(interaction.user.id, displayName, { favoriteStr: '초기화', dislikeStr: '초기화' });
                return interaction.followUp("✅ 식단 선호도가 모두 초기화되었습니다!");
            }

            if (like !== null || dislike !== null) {
                saveMemberFoodPreference(interaction.user.id, displayName, { favoriteStr: like, dislikeStr: dislike });
                
                const updated = getMemberFoodPreference(interaction.user.id);
                const favStr = updated.favorite.length > 0 ? updated.favorite.join(', ') : '없음';
                const disStr = updated.dislike.length > 0 ? updated.dislike.join(', ') : '없음';
                
                return interaction.followUp(`✅ 식단 선호도가 저장되었습니다!\n📋 **현재 선호도 설정**:\n- 좋아하는 음식: ${favStr}\n- 싫어하는 음식: ${disStr}`);
            } else {
                // 조회 로직
                const preference = getMemberFoodPreference(interaction.user.id);
                if (preference && (preference.favorite.length > 0 || preference.dislike.length > 0)) {
                    const favStr = preference.favorite.length > 0 ? preference.favorite.join(', ') : '없음';
                    const disStr = preference.dislike.length > 0 ? preference.dislike.join(', ') : '없음';
                    return interaction.followUp(`📋 **${displayName}**님의 식단 선호도:\n- 좋아하는 음식: ${favStr}\n- 싫어하는 음식: ${disStr}`);
                } else {
                    return interaction.followUp("📋 저장된 식단 선호도가 없습니다. `/food reference` 옵션을 사용해 입력해 보세요!");
                }
            }
        }
    },
};