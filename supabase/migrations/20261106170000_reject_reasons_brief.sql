-- Decline reasons: one for every criterion a campaign brief can set (gender, age, followers both ways, language,
-- pet, marital status, barter) next to the existing ones. ADDITIVE.
insert into public.rejection_reason_vocab(code, label, sort) values
  ('high_followers','Follower count too high for this campaign',25),
  ('gender_mismatch','Gender doesn''t match the brief',42),
  ('age_mismatch','Age outside the brief''s range',44),
  ('language_mismatch','Content language doesn''t match',52),
  ('pet_mismatch','Pet requirement not met',54),
  ('marital_mismatch','Marital status doesn''t match the brief',56),
  ('barter_not_open','Not open to a barter collaboration',58),
  ('no_instagram','Instagram not connected / not a creator or business account',95)
on conflict (code) do update set label = excluded.label, sort = excluded.sort;
