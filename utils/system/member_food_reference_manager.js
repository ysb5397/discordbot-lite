const fs = require('fs');
const path = require('path');
const config = require('../../config/manage_environments.js');

const FILE_PATH = path.join(__dirname, 'member_food_references.json');
const OWNER_ID = config.discord.ownerId;
const defaultData = {
  "discord_id": {
    "nickname": "",
    "favorite": [
      ""
    ],
    "dislike": [
      ""
    ]
  }
}

function readData() {
    try {
        if (fs.existsSync(FILE_PATH)) {
            return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('❌ [MemberFoodReferenceManager] JSON 읽기 실패:', e);
    }
    return {};
}

function saveData(data) {
    try {
        fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('❌ [MemberFoodReferenceManager] JSON 저장 실패:', e);
    }
}

function parseFoodList(str) {
    if (!str) return [];
    return str.split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0 && item !== '없음' && item !== '초기화');
}

function saveMemberFoodPreference(memberId, nickname, { favoriteStr, dislikeStr }) {
    try {
        const data = readData();
        
        // 기존 선호도가 없으면 새로 생성
        if (!data[memberId]) {
            data[memberId] = {
                nickname: nickname || "",
                favorite: [],
                dislike: []
            };
        }
        
        if (nickname) {
            data[memberId].nickname = nickname;
        }

        // 전체초기화 / 모두삭제 / void 키워드 체크
        if (
            favoriteStr === '전체초기화' || favoriteStr === '모두삭제' || favoriteStr === 'void' ||
            dislikeStr === '전체초기화' || dislikeStr === '모두삭제' || dislikeStr === 'void'
        ) {
            data[memberId].favorite = [];
            data[memberId].dislike = [];
            if (data[memberId].like !== undefined) {
                delete data[memberId].like;
            }
            saveData(data);
            return;
        }

        // favorite 처리
        if (favoriteStr !== undefined && favoriteStr !== null) {
            if (favoriteStr === '초기화' || favoriteStr === '없음' || favoriteStr === '') {
                data[memberId].favorite = [];
            } else {
                const inputList = favoriteStr.split(',').map(item => item.trim()).filter(item => item.length > 0);
                let currentList = data[memberId].favorite || [];

                for (const item of inputList) {
                    if (item.startsWith('-')) {
                        // 빼기 기호가 붙은 경우 리스트에서 제거
                        const target = item.substring(1).trim();
                        currentList = currentList.filter(food => food !== target);
                    } else if (item === '초기화' || item === '없음') {
                        currentList = [];
                    } else {
                        // 기존 리스트에 추가 (중복 방지)
                        if (!currentList.includes(item)) {
                            currentList.push(item);
                        }
                    }
                }
                data[memberId].favorite = currentList;
            }
        }

        // dislike 처리
        if (dislikeStr !== undefined && dislikeStr !== null) {
            if (dislikeStr === '초기화' || dislikeStr === '없음' || dislikeStr === '') {
                data[memberId].dislike = [];
            } else {
                const inputList = dislikeStr.split(',').map(item => item.trim()).filter(item => item.length > 0);
                let currentList = data[memberId].dislike || [];

                for (const item of inputList) {
                    if (item.startsWith('-')) {
                        // 빼기 기호가 붙은 경우 리스트에서 제거
                        const target = item.substring(1).trim();
                        currentList = currentList.filter(food => food !== target);
                    } else if (item === '초기화' || item === '없음') {
                        currentList = [];
                    } else {
                        // 기존 리스트에 추가 (중복 방지)
                        if (!currentList.includes(item)) {
                            currentList.push(item);
                        }
                    }
                }
                data[memberId].dislike = currentList;
            }
        }

        // 호환성을 위해 구버전 필드(like)는 삭제
        if (data[memberId].like !== undefined) {
            delete data[memberId].like;
        }

        saveData(data);
    } catch (e) {
        console.error('❌ [MemberFoodReferenceManager] 멤버 식단 선호도 저장 실패:', e);
    }
}

function getMemberFoodPreference(memberId) {
    try {
        const data = readData();
        const memberData = data[memberId];
        if (!memberData) return null;

        // 호환성 처리: 예전 데이터가 { like, dislike } 형태로만 존재했을 경우 파싱해서 가져옴
        let favorite = memberData.favorite;
        if (favorite === undefined && memberData.like !== undefined) {
            favorite = parseFoodList(memberData.like);
        }

        let dislike = memberData.dislike;
        if (dislike === undefined && memberData.dislike !== undefined) {
            if (typeof memberData.dislike === 'string') {
                dislike = parseFoodList(memberData.dislike);
            } else {
                dislike = memberData.dislike;
            }
        }

        return {
            nickname: memberData.nickname || "",
            favorite: favorite || [],
            dislike: dislike || []
        };
    } catch (e) {
        console.error('❌ [MemberFoodReferenceManager] 멤버 식단 선호도 조회 실패:', e);
        return null;
    }
}

module.exports = { saveMemberFoodPreference, getMemberFoodPreference };