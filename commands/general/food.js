const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getMenu, syncFoodData, getTodayString, getKstDate, getNextWeekDateString, getCurrentMealInfo, getSpecialDayReason, getMondayOfDate, generateFoodImage, isAdminUser, addSpecialDay, removeSpecialDay, getSpecialDaysList } = require('../../utils/system/food_manager.js');
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
        )
        .addSubcommandGroup(group =>
            group
                .setName('exception')
                .setDescription('학식 예외 날짜(휴강, 공휴일)를 관리합니다. (관리자 전용)')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('add')
                        .setDescription('예외 날짜를 추가합니다.')
                        .addStringOption(option =>
                            option.setName('day')
                                .setDescription('예외 날짜 (형식: YYYYMMDD 또는 YYYY-MM-DD)')
                                .setRequired(true)
                        )
                        .addStringOption(option =>
                            option.setName('reason')
                                .setDescription('예외 사유 (예: 금요일 휴강, 크리스마스)')
                                .setRequired(true)
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('remove')
                        .setDescription('예외 날짜를 제거합니다.')
                        .addStringOption(option =>
                            option.setName('day')
                                .setDescription('제거할 예외 날짜 (형식: YYYYMMDD 또는 YYYY-MM-DD)')
                                .setRequired(true)
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('list')
                        .setDescription('현재 등록된 예외 날짜 목록을 확인합니다.')
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const subcommandGroup = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand(false) || 'now';
        const { dateString, type, typeName, isNextWeek } = getCurrentMealInfo();

        // 1. 동기화 명령어 처리 (/food refresh)
        if (subcommand === 'refresh') {
            try {
                const syncDate = getNextWeekDateString();
                const result = await syncFoodData(true, interaction.user.id, syncDate);
                return interaction.followUp(result.message);
            } catch (err) {
                console.error('❌ [Food Command] 동기화 중 에러:', err);
                return interaction.followUp("❌ 크롤링 중 오류가 발생했습니다. 나중에 다시 시도해주세요.");
            }
        }

        // 2. 식단 조회 로직
        if (subcommand === 'now') {
            const specialReason = getSpecialDayReason(dateString);
            if (specialReason) {
                const embed = new EmbedBuilder()
                    .setColor(0xF39C12)
                    .setTitle(`📆 특별 알림 (${typeName})`)
                    .setDescription(`**[${dateString}]**\n\n오늘은 **${specialReason}**이야!\n굳이 학교에 안 와도 되니까, 학식 정보도 보여주지 않을게! 편히 쉬어~ 😴`)
                    .setFooter({ text: '공휴일/휴강일 정보는 시스템에 의해 관리되고 있어.' });

                return interaction.followUp({ embeds: [embed] });
            }

            let menuString = getMenu(dateString, type);

            let breakfast = getMenu(dateString, 'breakfast');
            let lunch = getMenu(dateString, 'lunch');

            const isBreakfastEmpty = breakfast === "등록된 식단이 없습니다." || breakfast.includes("식단 정보가 없습니다");
            const isLunchEmpty = lunch === "등록된 식단이 없습니다." || lunch.includes("식단 정보가 없습니다");

            if (isBreakfastEmpty && isLunchEmpty) {
                await syncFoodData(false, interaction.user.id, isNextWeek ? dateString : null);
                
                // 동기화 후 다시 해당 타입의 메뉴를 가져옴
                menuString = getMenu(dateString, type);
            }

            // 파스텔 그라데이션 이미지 굽기
            const imageBuffer = await generateFoodImage(dateString, typeName, menuString);
            const file = new AttachmentBuilder(imageBuffer, { name: 'food_menu.png' });

            const embed = new EmbedBuilder()
                .setColor(0xB3CFFB) 
                .setTitle(`🍽️ 학식 안내 (${typeName})`)
                .setImage('attachment://food_menu.png')
                .setFooter({ text: '데이터 동기화가 필요하면 /food refresh를 사용하세요.' });

            await interaction.followUp({ embeds: [embed], files: [file] });
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

        // 4. 예외 날짜 관리 처리 (/food exception)
        if (subcommandGroup === 'exception') {
            if (!isAdminUser(interaction.user.id)) {
                return interaction.followUp("❌ 이 명령어는 봇 관리자만 사용할 수 있어! 🙅");
            }

            const day = interaction.options.getString('day');
            const reason = interaction.options.getString('reason');

            if (subcommand === 'add') {
                const result = addSpecialDay(day, reason);
                return interaction.followUp(result.message);
            }

            if (subcommand === 'remove') {
                const result = removeSpecialDay(day);
                return interaction.followUp(result.message);
            }

            if (subcommand === 'list') {
                const list = getSpecialDaysList();
                const keys = Object.keys(list);
                if (keys.length === 0) {
                    return interaction.followUp("📋 등록된 학식 예외 날짜가 없어!");
                }
                let msg = "📋 **학식 예외 날짜(휴강/공휴일) 목록**:\n";
                keys.forEach(k => {
                    msg += `- **${k}**: ${list[k]}\n`;
                });
                return interaction.followUp(msg);
            }
        }
    },
};