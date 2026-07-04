// ============================================================================
// KRIPTOQUANT — Strategy Factory Types (Sprint 16)
// ============================================================================

export interface IndicatorConfig {
	readonly id: string;
	readonly type: 'ema' | 'sma' | 'rsi' | 'macd' | 'donchian' | 'atr' | 'supertrend';
	readonly params: any[];
}

export type ValueExpression = 
	| { type: 'indicator'; id: string }
	| { type: 'constant'; value: number }
	| { type: 'binary'; operator: '+' | '-' | '*' | '/'; left: ValueExpression; right: ValueExpression };

export type ConditionOperator = 
	| '>' | '<' | '>=' | '<=' | '==' 
	| 'cross-above' | 'cross-below' 
	| 'AND' | 'OR';

export interface ConditionConfig {
	readonly type: 'comparison' | 'crossover' | 'logical';
	readonly operator: ConditionOperator;
	readonly left?: ValueExpression;
	readonly right?: ValueExpression;
	readonly conditions?: ConditionConfig[];
}

export interface StrategyConfig {
	readonly metadata: {
		readonly name: string;
		readonly version: string;
		readonly tags: string[];
		readonly category?: string;
		readonly author?: string;
	};
	readonly warmupPeriod: number;
	readonly indicators: IndicatorConfig[];
	readonly filters?: ConditionConfig[];
	readonly entry: ConditionConfig;
	readonly exit: ConditionConfig;
}

export interface CompiledStrategy {
	readonly strategy: import('../../../core/types.js').Strategy;
	readonly config: StrategyConfig;
	readonly indicatorsData: Map<string, any>;
}
