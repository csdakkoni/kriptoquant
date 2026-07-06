import { describe, it, expect, beforeEach } from 'vitest';
import { PositionStateMachine } from '../../src/execution/position-state-machine.js';

describe('PositionStateMachine Unit Tests', () => {
	let machine: PositionStateMachine;

	beforeEach(() => {
		machine = new PositionStateMachine();
	});

	it('should default positions to PENDING_SUBMIT status', () => {
		expect(machine.getState('POS-1')).toBe('PENDING_SUBMIT');
	});

	it('should allow valid transition paths', () => {
		// Valid path: PENDING_SUBMIT -> ACTIVE -> CLOSED
		const activeOk = machine.transitionTo('POS-1', 'ACTIVE');
		expect(activeOk).toBe(true);
		expect(machine.getState('POS-1')).toBe('ACTIVE');

		const closedOk = machine.transitionTo('POS-1', 'CLOSED');
		expect(closedOk).toBe(true);
		expect(machine.getState('POS-1')).toBe('CLOSED');
	});

	it('should veto invalid transitions that break sequence integrity', () => {
		// Invalid path: PENDING_SUBMIT -> CLOSED directly
		const invalidOk = machine.transitionTo('POS-2', 'CLOSED');
		expect(invalidOk).toBe(false);
		expect(machine.getState('POS-2')).toBe('PENDING_SUBMIT');
	});
});
