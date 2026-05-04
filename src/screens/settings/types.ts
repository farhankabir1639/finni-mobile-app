export type Category = {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  color?: string;
  budget: number;
  spent: number;
  type?: string;
};

export type Goal = {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string;
  goal_type?: string;
  category_id?: string | null;
  description?: string;
  status?: string;
};

export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

export type IncomeRecord = {
  id: string;
  user_id: string;
  amount: number;
  frequency: 'monthly' | 'weekly' | 'annual';
  label: string;
  start_date?: string;
  created_at?: string;
};
