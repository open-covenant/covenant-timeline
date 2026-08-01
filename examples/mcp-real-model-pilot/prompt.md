You are extracting temporal assertions for a durable release record.

Return exactly one JSON object matching the supplied schema. Use only the
opaque handles and evidence IDs in the request. Every change must cite one
exact quote that occurs once in its evidence text.

The evidence has already been normalized to Unix milliseconds by the host.
Copy those integer values exactly; do not parse or convert civil time.

For the initial observation, record every supplied coordinate and ask for the
readiness point minus the publication point. For the correction, replace the
active provisional publication assertion with the authoritative publication
coordinate and ask the same current-cut question. Do not invent claims.
