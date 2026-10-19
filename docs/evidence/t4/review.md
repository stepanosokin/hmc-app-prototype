# T4 two-axis code review

Fixed point: `9bd76710281014a67b80d596987cb6481e384061`.
Initial implementation: `c502266`. Independent parallel reviewers examined
`git diff 9bd76710281014a67b80d596987cb6481e384061...HEAD`; targeted follow-up
reviews inspected the subsequent corrections before the final commit.

## Standards

**P2 — Reuse verified samplers across requests.** `docs/storage.md` requires
constructing a sampler once per trusted immutable manifest and reusing it.
Originally each point/tile request constructed another sampler and repeated
publication-wide asset hashing. Cache verified instances by immutable path and
checksum while checking catalogue eligibility per request.

**Resolved.** Both verified-object caches are bounded to eight entries and keyed
by immutable path/checksum; `resolve()` still checks catalogue eligibility each
request. Follow-up also found that the new `.gitattributes` rules had replaced
the existing T3 byte-preservation rule. That rule was restored before adding
T4's LF rules. The final targeted review found no additional actionable issue
in cache eligibility, record mapping, commit/rollback, JSON adaptation or
historical evidence preservation. No additional baseline code smells were found.

## Spec

**P2 — Server failures reported as invalid client requests.** The specification
distinguishes “invalid input (400)” from “transient processing/service failure
(503).” The original generic ValueError handler also caught GeoServer exception
documents and asset-integrity failures, returning 400 with backend XML.

**Resolved.** Dedicated publication-unavailable errors and upstream/storage/
database handlers return a sanitized 503; request validation retains 400.
A real disabled GeoServer coverage reproduced the original 400 through the
gateway. The corrected test checks 503, continuing numerical metadata access,
coverage restoration and map 200. Targeted review confirmed atomic catalogue/job
publication and rollback remain intact after changing the PostgreSQL driver.
No missing scoped requirement or scope creep was identified; QGIS/GPU/operational
gates remain separate. Fresh Compose execution, rather than static review,
establishes the final runtime behavior.

Standards: original cache finding and follow-up evidence rule both resolved;
**0 unresolved**. Spec: original error-classification finding resolved;
**0 unresolved**. Native-runtime compatibility failure and its retained evidence
are recorded separately in [validation](validation.md).
