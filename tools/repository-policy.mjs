const browserPersistencePatterns = [
  /\blocalStorage\b/u,
  /\bsessionStorage\b/u,
  /\bindexedDB\b/u,
];

export function browserCredentialPersistenceViolations(source) {
  return browserPersistencePatterns.filter((pattern) => pattern.test(source)).map(String);
}

export function nonEmptySecretExampleViolations(source) {
  const violations = [];
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]*(?:KEY|SECRET|PASSWORD|TOKEN)[A-Z0-9_]*)=(.*)$/u);
    if (match && match[2]?.trim()) violations.push(match[1]);
  }
  return violations;
}
