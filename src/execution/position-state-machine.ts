// ============================================================================
// KRIPTOQUANT — Position Lifecycle State Machine (Sprint 35)
// ============================================================================

export type PositionState = 'PENDING_SUBMIT' | 'ACTIVE' | 'PENDING_REDUCE' | 'CLOSED' | 'CANCELLED';

export class PositionStateMachine {
	private states = new Map<string, PositionState>();

	// Deterministik durum geçiş matrisi
	private validTransitions: Record<PositionState, PositionState[]> = {
		PENDING_SUBMIT: ['ACTIVE', 'CANCELLED'],
		ACTIVE: ['PENDING_REDUCE', 'CLOSED'],
		PENDING_REDUCE: ['ACTIVE', 'CLOSED'],
		CLOSED: [], // final state
		CANCELLED: [] // final state
	};

	/**
	 * Pozisyonun durumunu sorgular. Kayıtlı değilse PENDING_SUBMIT varsayar.
	 */
	public getState(positionId: string): PositionState {
		return this.states.get(positionId) || 'PENDING_SUBMIT';
	}

	/**
	 * Durum geçişini kontrol eder ve geçerli geçişse durumu günceller.
	 * Hatalı geçiş durumunda veto ederek false döner.
	 * 
	 * @param positionId - Pozisyon ID
	 * @param targetState - Geçiş hedeflenen yeni durum
	 */
	public transitionTo(positionId: string, targetState: PositionState): boolean {
		const currentState = this.getState(positionId);

		// If already in target state, ignore as redundant
		if (currentState === targetState) return true;

		// Check if transition is valid
		const allowed = this.validTransitions[currentState] || [];
		if (!allowed.includes(targetState)) {
			// VETO invalid transition to prevent double-spend or mismatch state
			return false;
		}

		this.states.set(positionId, targetState);
		return true;
	}

	public clear(): void {
		this.states.clear();
	}
}
