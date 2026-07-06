import { describe, it, expect, beforeEach } from 'vitest';
import { OrderBookSimulator } from '../../src/execution/order-book-simulator.js';

describe('OrderBookSimulator Unit Tests', () => {
	let simulator: OrderBookSimulator;

	beforeEach(() => {
		simulator = new OrderBookSimulator();
	});

	it('should support limit orders and match taker trades via Price-Time Priority', () => {
		simulator.resetToDefaults();
		
		// Add top ask limit order (lowest sell price)
		const orderId = simulator.addLimitOrder('SELL', 100.1, 5);
		expect(orderId).toBeDefined();

		// Match taker BUY of 3 shares - should match the newly added ask at 100.1 first
		const match = simulator.matchAgainstTaker('BUY', 3);
		expect(match.filledQuantity).toBe(3);
		expect(match.averageFillPrice).toBe(100.1);
		expect(match.remainingQuantity).toBe(0);
	});

	it('should consume asks step-by-step through order book depths', () => {
		simulator.resetToDefaults();

		// Match a large taker buy order that sweeps multiple ask levels
		const match = simulator.matchAgainstTaker('BUY', 40);
		expect(match.filledQuantity).toBe(40);
		expect(match.averageFillPrice).toBeGreaterThan(100.0);
	});
});
