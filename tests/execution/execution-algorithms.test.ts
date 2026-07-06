import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionAlgorithms } from '../../src/execution/execution-algorithms.js';

describe('ExecutionAlgorithms Unit Tests', () => {
	let algos: ExecutionAlgorithms;

	beforeEach(() => {
		algos = new ExecutionAlgorithms();
	});

	it('should generate randomized TWAP chunks that sum to total size', () => {
		const schedule = algos.generateTwapSchedule(100, 5);
		expect(schedule.length).toBe(5);
		const sum = schedule.reduce((acc, slice) => acc + slice.size, 0);
		expect(sum).toBeCloseTo(100, 2);
	});

	it('should generate VWAP chunks proportional to historical market volume', () => {
		const volumes = [1000, 2000, 3000, 4000];
		const schedule = algos.generateVwapSchedule(100, volumes);

		expect(schedule.length).toBe(4);
		expect(schedule[0].size).toBe(10); // 1000 / 10000 * 100
		expect(schedule[3].size).toBe(40); // 4000 / 10000 * 100
		expect(schedule[3].participationRate).toBe(40);
	});
});
