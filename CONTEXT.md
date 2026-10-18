# Sentry Bug Remediation

The language used when investigating Sentry reports and proposing fixes to the affected codebase.

## Language

**Sentry issue**:
A grouped report of related occurrences in Sentry. An issue is distinct from any individual occurrence and is not itself proof of a defect that can be fixed in the repository.
_Avoid_: Event, crash (when referring to the grouped report)

**Sentry event**:
An individual captured occurrence associated with a Sentry issue. Multiple events can belong to the same issue.
_Avoid_: Issue, bug (when referring to an individual occurrence)

**Demonstration project**:
A small, controlled codebase with intentionally triggerable errors, used to evaluate the investigation and remediation workflow. It is the monitored application, not the operator application.
_Avoid_: Production application, operator application, benchmark suite (when referring to the pilot codebase)

**Fix pull request**:
A proposed source-code change addressing a Sentry issue. Its existence does not establish that the error has stopped in the deployed application.
_Avoid_: Resolution, deployed fix (when only a pull request exists)

**Operator application**:
The application a person uses to inspect issues, converse with the agent, and control remediation work. It is separate from the monitored demonstration project.
_Avoid_: Demonstration project, monitored application

**Sentry priority**:
Sentry's High, Medium, or Low classification of an issue's urgency. It is not permission for this tool to change code automatically.
_Avoid_: Critical status, fix eligibility

**Escalating issue**:
A Sentry issue whose occurrence volume exceeds Sentry's forecast according to its escalation rules. Escalation is distinct from priority and does not establish that a repository patch is the correct remedy.
_Avoid_: High-priority issue (when specifically referring to escalation)

**Fix eligibility**:
Whether an issue is suitable and permitted for an automatic code-fix attempt by this tool. An urgent issue can still be ineligible.
_Avoid_: Priority, severity

**Investigation candidate**:
A Sentry issue selected for investigation before deciding whether an automatic fix is suitable. Selection alone does not grant permission to edit code.
_Avoid_: Approved fix, fix-eligible issue

**Triage**:
The determination of what should happen next to a Sentry issue. It is distinct from implementing a fix or declaring the deployed error resolved.
_Avoid_: Fixing, resolution

**Work-in-progress fix PR**:
An ordinary fix pull request marked as unfinished when native drafts are unavailable. The marker is informational and does not itself prevent merging.
_Avoid_: Native draft PR

**Remediation session**:
An issue-scoped body of investigation and possible fix work, from triage to a fix proposal or another outcome. Different issues have independent sessions; pausing and continuing preserve a session's identity.
_Avoid_: Login session, whole controller

**Remediation phase**:
The kind of work currently underway in a remediation session, such as triage, investigation, implementation, testing, or PR creation. It is distinct from Sentry's issue status and from whether work is paused.
_Avoid_: Sentry status, pause state

**Proposed solution**:
An explanation of the intended change and why it should address the issue. It is not an implemented or verified fix.
_Avoid_: Implemented fix, verified fix

**Paused remediation session**:
A remediation session deliberately waiting for the operator to continue it, retaining its current phase, context, and remaining execution allowance.
_Avoid_: Aborted session, resolved issue

**Remediation workspace**:
The isolated working copy of source code used to inspect, edit, and test one remediation session's proposed change. It is distinct from the operator's default checkout, another session's workspace, and the recorded remediation history and validation evidence.
_Avoid_: Default checkout, shared workspace, history archive

**Candidate revision**:
A specific version of a proposed code change to which validation results apply. Results for an earlier revision do not validate a newer one.
_Avoid_: Latest code (without identifying the version)

**Validation evidence**:
Recorded results and observations from checks actually run against a candidate revision. It is distinct from the agent's testing assessment and does not establish complete correctness.
_Avoid_: Agent claim, proof of complete coverage

**Testing assessment**:
The agent's account of what it checked and its judgment of whether the candidate was adequately tested, including limitations. It is not itself a recorded test result.
_Avoid_: Test result, validation evidence

**Issue ownership**:
The exclusive responsibility of one unfinished remediation session for a Sentry issue. Pausing the session preserves that responsibility.
_Avoid_: Currently running work

**Awaiting merge**:
A remediation session with a published fix PR that is not yet known to have been merged. It retains issue ownership without requiring an executing agent.
_Avoid_: Running agent, resolved issue

**Merged fix PR**:
A fix pull request whose changes have been incorporated into its target branch. Merge alone does not establish that the running application includes the fix or that the Sentry error has stopped.
_Avoid_: Deployed fix, resolved issue

**Needs attention**:
A remediation session paused because it cannot proceed within its permitted checks or execution budget. It retains its phase, context, and issue ownership without occupying execution capacity.
_Avoid_: Running agent, discarded work

**Qualifying recurrence**:
A newly observed occurrence of a previously handled issue from a running version known to incorporate its merged fix in its version history. It can prompt renewed investigation, but does not establish the same root cause or prove that the earlier change was correct.
_Avoid_: Any report received after merge, Sentry regression (unless Sentry also identifies one)

**Remediation history**:
The recorded earlier attempts to handle one issue, including proposed changes, failed checks, published or merged fixes, and their outcomes. Observed results remain distinguishable from agent assessments when later sessions consult this history.
_Avoid_: Last successful PR only, assumed agent memory

**Dismissed remediation session**:
A session closed by explicit operator choice without further automatic work. Dismissal does not resolve the Sentry issue; renewed work requires another explicit operator action.
_Avoid_: Resolved issue, paused work

**No fix needed**:
A local triage outcome that no repository change is appropriate under the current assessment. It does not resolve the Sentry issue, establish that an error can never recur, or mean a suspected defect simply could not be reproduced.
_Avoid_: Fixed issue, permanently unfixable, not reproducible

**Active-work budget**:
The time allowance for actively executing remediation, excluding time queued, paused, or awaiting merge.
_Avoid_: Session age, wall-clock deadline

**Continue**:
The operator action that resumes a manually paused remediation session with its remaining execution allowance and repair count.
_Avoid_: Retry, requeue

**Retry**:
An explicit operator-authorized execution attempt for a Needs attention session, granting a fresh bounded allowance while retaining the session's identity and earlier history.
_Avoid_: Continue, new remediation session

**Requeue**:
An explicit operator request for a fresh remediation session after a terminal outcome. The new session is linked to earlier history and remains subject to ownership and fix-eligibility checks.
_Avoid_: Continue, erase history
