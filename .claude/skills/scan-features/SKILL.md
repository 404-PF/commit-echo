---
name: scan-features
description: 'Deeply scan and analyze the codebase for potential new features, then open GitHub issues to submit them. USE FOR: discovering missing functionality, finding unimplemented ideas, identifying feature gaps, suggesting enhancements, finding TODOs and stubs that indicate planned work. Triggers: scan features, find feature gaps, suggest new features, discover missing functionality, feature audit, what features are missing.'
argument-hint: '[optional: focus area like api, ui, cli, performance, or all]'
user-invocable: true
---

# Scan Features

## When to Use

- Discover missing or incomplete features in the codebase
- Identify TODO/FIXME/HACK comments that indicate planned but unimplemented work
- Find stub functions, placeholder implementations, or skeleton code
- Detect patterns where a feature exists in one place but is missing in another
- Spot configuration options, CLI flags, or API endpoints that are referenced but not implemented
- Audit documentation or specs against actual implementation to find gaps
- Suggest enhancements based on common best practices for the tech stack

## Procedure

### 1. Understand the Codebase

- Read `package.json`, `tsconfig.json`, or equivalent project config to understand the tech stack
- Identify the main source directories, entry points, and module structure
- Note the project's purpose and domain from README or docs
- Review any existing specs, RFCs, or design documents

### 2. Define Scan Scope

Determine what to scan based on the user's request or codebase context:

| Focus Area | What to Look For |
|-----------|------------------|
| **api** | Missing endpoints, incomplete request handlers, stub route definitions, referenced but unimplemented API calls |
| **ui** | Placeholder components, commented-out UI sections, missing loading/error states, TODO labels in templates |
| **cli** | Unimplemented commands, missing flags, incomplete argument parsing, help text for features not yet built |
| **performance** | Missing caching layers, absent pagination, no lazy loading, absent rate limiting or throttling |
| **testing** | Untested modules, skipped test files, test stubs with no implementation |
| **all** | Comprehensive scan across all categories above plus the cross-cutting indicators below |

### 3. Scan for Feature Indicators

Work through the source files systematically. For each file, look for these signals:

#### Explicit Indicators (High Confidence)
- **TODO/FIXME/HACK/XXX comments** — Direct evidence of planned work
- **Stub functions** — Functions with empty bodies, `NotImplementedError`, or placeholder returns
- **Commented-out code** — Previously working code that was disabled, suggesting incomplete refactoring
- **`throw new Error("Not implemented")`** — Explicit markers of unbuilt functionality

#### Pattern-Based Indicators (Medium Confidence)
- **Missing error handling** — Try blocks without catch, unhandled promise rejections
- **Absent validation** — Input handlers without parameter validation
- **Incomplete CRUD** — Some operations implemented (GET, POST) but others missing (PUT, DELETE)
- **Feature parity gaps** — Similar modules where one has a capability the other lacks
- **Configuration without implementation** — Config keys defined but never read or used

#### Spec-Based Indicators (Requires Docs)
- **Documentation gaps** — README or docs describe features not found in source
- **Unused imports or dependencies** — Packages installed but not used, suggesting planned features
- **Type definitions without implementations** — Interfaces or types defined but never instantiated

### 4. Analyze and Classify

For each finding:

1. **Identify** the feature opportunity (what could be built)
2. **Classify** by confidence level and effort estimate
3. **Assess** the impact (user value, technical debt reduction, completeness)

| Confidence | Source | Action |
|-----------|--------|--------|
| **High** | Explicit TODOs, stubs, commented-out code | Strong candidate for an issue |
| **Medium** | Pattern gaps, missing CRUD, parity issues | Worth investigating further |
| **Low** | Spec gaps, unused deps, best-practice suggestions | Suggest only if clearly valuable |

**Effort Estimate**:
- **S** — Small (< 1 day): Fix a stub, add a missing validation, implement a simple handler
- **M** — Medium (1–3 days): Add a new endpoint, implement a missing CRUD operation
- **L** — Large (3+ days): New subsystem, major refactoring, new architectural layer

### 5. Deduplicate and Prioritize

- Merge duplicate or overlapping findings
- Group related features that could be bundled into a single issue
- Rank by impact × confidence:
  - **Immediate**: High confidence + High impact
  - **Planned**: High confidence + Low impact, or Medium confidence + High impact
  - **Backlog**: Medium confidence + Low impact
  - **Skip**: Low confidence + Low impact

### 6. Create GitHub Issues

For each prioritized finding (or group of related findings), create a GitHub issue using the GitHub MCP tools:

1. **Title**: Use format `[Feature] Short description` (e.g., `[Feature] Add retry logic for external API calls`)
2. **Labels**: Apply appropriate labels based on focus area and effort
3. **Body**: Include:
   - **Description**: What feature is missing and why it would be valuable
   - **Location**: Exact file path(s) and line number(s) with the indicator
   - **Evidence**: The TODO comment, stub function, or pattern gap
   - **Proposed solution**: How the feature could be implemented
   - **Effort estimate**: S / M / L
   - **Impact**: What improves if this is built

### 7. Summary Report

After scanning, provide the user with a summary:

```
## Feature Scan Results

| Category | High | Medium | Low | Total |
|----------|------|--------|-----|-------|
| API | X | X | X | X |
| UI | X | X | X | X |
| CLI | X | X | X | X |
| Performance | X | X | X | X |
| Testing | X | X | X | X |
| Cross-cutting | X | X | X | X |
| **Total** | **X** | **X** | **X** | **X** |

### Top Recommendations

1. **[Feature]** Short description — [Effort: S/M/L] — [Impact: High/Med/Low]
   - Location: `path/to/file.ts:42`
   - Evidence: `// TODO: implement retry logic`

Issues created: [list links to created issues]
```

## Guidelines

- **Be specific**: Every finding must reference an exact file, line number, and the specific indicator
- **Be actionable**: Include a proposed solution, not just a vague suggestion
- **Avoid overreach**: Don't invent features the project doesn't need — focus on evidence in the code
- **Respect project scope**: Only suggest features that align with the project's domain and goals
- **Don't overwhelm**: Group minor, related features into a single issue rather than creating many small ones
- **Distinguish tech debt from features**: TODOs about refactoring are tech debt, not features — label them accordingly
