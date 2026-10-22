type ProfileNameCaseId = (typeof profileNameDefinition.cases)[number]['id'];
export type ProfileNameActual =
  | Readonly<{ caseId: ProfileNameCaseId; kind: 'returned'; value: string }>
  | Readonly<{ caseId: ProfileNameCaseId; kind: 'invalid-return' | 'threw' }>;

export const profileNameDefinition = {
  id: 'profile-name-v1',
  version: 1,
  helper: 'src/lib/errors.js',
  exportName: 'getUserDisplayName',
  document: '/__eitri_profile.html',
  wrapper: '/__eitri_profile.mjs',
  reviewedCapture: {
    version: 1,
    scenarioId: 'profile-name-v1',
    provenance: { kind: 'uncommitted-copy' },
    source: {
      virtualPath: 'src/lib/errors.js',
      size: 525,
      sha256: '5fa6710bb0c4f120408d489d0b16f6a21bfc6e539081ab1d9fda7a3bddb1fa07',
    },
    captureDigest: '4a0ca6e84af5aa34eb429049c177762746b9acc0c6c0f35d75503900e51c2312',
  },
  cases: [
    { id: 'missing-profile', input: { kind: 'json', value: {} }, expected: 'Anonymous' },
    {
      id: 'trimmed-name',
      input: { kind: 'json', value: { profile: { name: '  Ada Lovelace  ' } } },
      expected: 'Ada Lovelace',
    },
    {
      id: 'second-name',
      input: { kind: 'json', value: { profile: { name: 'gRaCe Hopper' } } },
      expected: 'gRaCe Hopper',
    },
    {
      id: 'blank-name',
      input: { kind: 'json', value: { profile: { name: ' \t ' } } },
      expected: 'Anonymous',
    },
    { id: 'missing-name', input: { kind: 'json', value: { profile: {} } }, expected: 'Anonymous' },
    {
      id: 'null-name',
      input: { kind: 'json', value: { profile: { name: null } } },
      expected: 'Anonymous',
    },
    {
      id: 'null-profile',
      input: { kind: 'json', value: { profile: null } },
      expected: 'Anonymous',
    },
    { id: 'null-user', input: { kind: 'json', value: null }, expected: 'Anonymous' },
    { id: 'undefined-user', input: { kind: 'undefined' }, expected: 'Anonymous' },
  ],
  diagnostic: {
    caseId: 'missing-profile',
    nativeTypeError: true,
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'name')",
    firstFrame: 'at getUserDisplayName (/src/lib/errors.js:5:23)',
  },
} as const;
