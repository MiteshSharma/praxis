ALTER TABLE jobs
  ADD COLUMN total_input_tokens  int,
  ADD COLUMN total_output_tokens int,
  ADD COLUMN total_cost_usd      real;
