const { Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getTodayString } = require('../utils/system/food_manager.js');

const { getChatResponseStreamOrFallback } = require('../utils/ai/ai_helper.js'); 

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        // 봇이 보낸 메시지는 무시
        if (message.author.bot) return;

        // 봇이 멘션되었는지 확인
        if (!message.mentions.has(client.user)) return;

        // 멘션 태그(<@봇ID>)를 지우고 순수 질문 내용만 남기기
        const userQuery = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

        // 아무 말 없이 멘션만 한 경우
        if (userQuery.length === 0) {
            return message.reply('학식 메뉴가 궁금하면 나를 태그하고 "내일 점심 뭐야?"라고 물어봐줘! 😋');
        }

        // 4. 음식 관련 질문인지 대충 키워드로 검사
        const foodKeywords = ['학식', '밥', '메뉴', '조식', '중식', '석식', '아침', '점심', '저녁', '식단', '면', '고기', '돈까스', '뭐', '나와'];
        const isFoodQuery = foodKeywords.some(keyword => userQuery.includes(keyword));

        // --- 🍔 학식 관련 질문일 때 (AI + 로컬 파일 RAG) ---
        if (isFoodQuery) {
            try {
                await message.channel.sendTyping(); // "봇이 입력 중..." 상태 표시

                // 1) 캐싱된 food_data.json 읽어오기
                const filePath = path.join(__dirname, '../utils/system/food_data.json');
                let foodDataStr = "아직 크롤링된 데이터가 없어! /food refresh를 먼저 해줘.";
                
                if (fs.existsSync(filePath)) {
                    const rawData = fs.readFileSync(filePath, 'utf8');
                    const parsed = JSON.parse(rawData);
                    
                    // AI가 쉽게 읽도록 날짜-메뉴 객체만 예쁘게 문자열로 변환해서 넘김
                    foodDataStr = JSON.stringify(parsed.menus, null, 2);
                }

                const today = getTodayString();

                // 2) AI에게 부여할 강력한 프롬프트 셋팅!
                const systemPrompt = `
                    [System]
                    너는 폴리텍 부산캠퍼스의 귀엽고 친절한 '학식 알리미 챗봇'이야. 사용자에게 다정하고 편한 반말로 대답해줘.
                    오늘 날짜는 ${today}야.
                    아래 제공된 [이번 주 학식 데이터]를 꼼꼼히 읽고, 사용자의 질문에 정확하고 센스 있게 답변해줘.

                    [답변 규칙]
                    1. 데이터에 없는 날짜(다음 주 등)를 물어보면 "아직 그 날짜의 식단은 안 나왔어 ㅠㅠ"라고 안내해.
                    2. 특정 메뉴(예: 면요리, 고기)를 물어보면, 데이터 안에서 해당 메뉴가 있는 날짜와 식사(조/중/석식)를 찾아서 알려줘.
                    3. 데이터가 비어있거나 "등록된 식단이 없습니다."라고 되어있으면 식사가 없는 걸로(예: 주말) 처리해.
                    4. 요약해서 핵심만 말하되, 먹음직스러운 이모티콘을 적극적으로 사용해줘!
                    5. 아래 사용자의 질문 내용과 무관한 말은 지어내지 마.
                    6. 지금 넘겨주는 학식 데이터는 모두 실시간으로 가져온 데이터니까 신뢰도는 걱정하지 않아도 돼.

                    [이번 주 학식 데이터]
                    ${foodDataStr}

                    [사용자 질문]
                    ${userQuery}
                `;

                const reply = await getChatResponseStreamOrFallback(systemPrompt);
                
                await message.reply(reply);
                return;

            } catch (error) {
                console.error('학식 AI 응답 처리 중 에러:', error);
                return message.reply('앗! 학식 정보를 AI로 처리하다가 에러가 났어! (콘솔 확인해봐!)');
            }
        } 
        
        // --- 💬 학식 외의 일반 멘션 대화일 때 ---
        else {
            return message.reply('나한테 학식을 물어보고 싶다면 "내일 점심 뭐야?", "오늘 면요리 나와?" 처럼 물어봐줘! 🍱\n(명령어로 확인하려면 `/food`를 쳐줘!)');
        }
    },
};