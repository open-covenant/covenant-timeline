# Prediction-Market Dispute

A market closes, receives a provisional oracle determination, is challenged,
receives an amended ruling, reaches declared finality, and settles.

The initial determination, challenge, evidence, ruling, final outcome, and
settlement remain separate append-only events. Current-state projections may
show the final result without deleting the dispute history.

The scenario fails if settlement becomes eligible before the contract's
finality policy, an amendment rewrites the original rules, or a market price is
treated as a ground-truth calibrated probability.
