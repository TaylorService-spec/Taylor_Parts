# Work Order model interpretation

This slice extends the North Star Work Order intelligence path with a model-output verification contract. It does not activate model calls yet.

EOS remains authoritative for observed facts, evidence/provenance, current-user authority, governed actions and outcomes. A model may supply only interpretation, business consequence, confidence and references to evidence keys EOS already supplied. It may repeat an action id only when EOS independently supplied that exact governed action as eligible for recommendation.

Any extra field, invented evidence key, unsupported action, malformed output or ungrounded response fails closed to `speak:false`. No partial model prose is salvaged into the North Star surface.

The prompt payload is built only from sanitized Work Order context. Raw Firestore ids and database handles are outside the contract.

Current scope remains sandbox/test operational context. This PR does not authorize historical/private Taylor customer data, does not change `CUSTOMER_DATA` policy, does not add operational writes, and does not activate a provider endpoint.
