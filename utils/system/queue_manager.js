const config = require('../../config/manage_environments.js');
const OWNER_IDS = config.discord.ownerId.split(',').map(id => id.trim());

class QueueManager {
    constructor() {
        this.activeRequests = 0; // 현재 봇이 처리 중인 작업 수
        this.MAX_SLOTS = 3;      // 최대 동시 처리 가능 인원
    }

    /**
     * 봇이 현재 사용자의 요청을 처리할 수 있는지 확인합니다.
     * @param {string} userId - 명령어를 사용한 유저 ID
     * @returns {boolean} 처리 가능 여부 (true면 통과)
     */
    canProcess(userId) {
        // 1. 관리자는 대기열 슬롯을 무시하고 무조건 통과
        let isOwner = false;
        OWNER_IDS.forEach(ownerId => {
            if (userId === ownerId) {
                isOwner = true;
            }
        });
        if (isOwner) return true;

        // 2. 현재 처리 중인 작업이 최대 슬롯(3개)보다 적으면 통과
        if (this.activeRequests < this.MAX_SLOTS) {
            return true;
        }

        // 3. 자리가 꽉 찼으면 차단
        return false;
    }

    /**
     * 요청 처리를 시작할 때 슬롯을 1개 차지합니다.
     */
    enter(userId) {
        let isOwner = false;
        OWNER_IDS.forEach(ownerId => {
            if (userId === ownerId) {
                isOwner = true;
            }
        });
        if (!isOwner) {
            this.activeRequests++;
            console.log(`📥 [Queue] 요청 들어옴 (현재 사용중: ${this.activeRequests}/${this.MAX_SLOTS})`);
        }
    }

    /**
     * 요청 처리가 끝났을 때(성공/실패 무관) 슬롯을 반환합니다.
     */
    leave(userId) {
        let isOwner = false;
        OWNER_IDS.forEach(ownerId => {
            if (userId === ownerId) {
                isOwner = true;
            }
        });
        if (!isOwner) {
            this.activeRequests--;
            if (this.activeRequests < 0) this.activeRequests = 0; // 혹시 모를 음수 방지
            console.log(`📤 [Queue] 요청 끝남 (현재 사용중: ${this.activeRequests}/${this.MAX_SLOTS})`);
        }
    }
}

// 싱글톤으로 내보내서 앱 전체에서 하나의 큐 매니저를 공유하게 함
module.exports = new QueueManager();