// W3C Verifiable Credential schema for MT Skill Verification
export const VerifiedSkillCredentialSchema = {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://moltrust.ch/schemas/skill/v1',
  ],
  type: ['VerifiableCredential', 'VerifiedSkillCredential'],
  credentialSubject: {
    id: 'did:base:<author-did>',
    skillName: '<skill-name>',
    skillVersion: '<semver-or-git-sha>',
    skillHash: 'sha256:<canonical-hash>',
    repositoryUrl: 'https://github.com/<org>/<repo>',
    audit: {
      score: 100,
      findings: [],
      passedAt: '<ISO8601>',
      auditorVersion: '1.2.0',
    },
    anchorTx: '0x<tx-hash>',
    issuedBy: 'did:web:moltrust.ch',
  },
} as const;

export interface AuditFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  description: string;
  deduction: number;
  line?: number;
}

export interface SkillAudit {
  score: number;
  findings: AuditFinding[];
  passedAt: string;
  auditorVersion: string;
}

export interface VerifiedSkillCredentialSubject {
  id: string;
  skillName: string;
  skillVersion: string;
  skillHash: string;
  repositoryUrl: string;
  audit: SkillAudit;
  anchorTx?: string;
  issuedBy: string;
}

export interface VerifiedSkillCredential {
  '@context': string[];
  type: string[];
  issuer: { id: string; name: string };
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: VerifiedSkillCredentialSubject;
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    jws: string;
  };
}

export interface SkillAuditResult {
  score: number;
  passed: boolean;
  findings: AuditFinding[];
  skillHash: string;
  skillName: string;
  skillVersion: string;
}
