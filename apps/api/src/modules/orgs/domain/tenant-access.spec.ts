import {
  administeredOrgIds,
  assertOrgAdmin,
  isOrgAdmin,
  isOrgMember,
  OrgAccessDeniedError,
  type Membership,
} from './tenant-access';

const APT_A = { orgKind: 'APARTMENT' as const, orgId: 'apt-a' };
const APT_B = { orgKind: 'APARTMENT' as const, orgId: 'apt-b' };
const BIZ_A = { orgKind: 'BUSINESS' as const, orgId: 'biz-a' };

const adminOf = (org: { orgKind: 'APARTMENT' | 'BUSINESS'; orgId: string }): Membership => ({
  ...org,
  orgRole: 'ADMIN',
});
const memberOf = (org: { orgKind: 'APARTMENT' | 'BUSINESS'; orgId: string }): Membership => ({
  ...org,
  orgRole: 'MEMBER',
});

describe('tenant access', () => {
  describe('isOrgAdmin', () => {
    it('is true only for the exact org the user administers', () => {
      const memberships = [adminOf(APT_A)];

      expect(isOrgAdmin(memberships, 'APARTMENT', 'apt-a')).toBe(true);
      // The whole point: admin of A is NOT admin of B.
      expect(isOrgAdmin(memberships, 'APARTMENT', 'apt-b')).toBe(false);
    });

    it('does not confuse an apartment and a business with the same id', () => {
      // Ids are unique per table, but the check must key on kind too — otherwise an apartment
      // admin could reach a business that happened to share a uuid.
      const memberships = [adminOf({ orgKind: 'APARTMENT', orgId: 'shared-id' })];

      expect(isOrgAdmin(memberships, 'APARTMENT', 'shared-id')).toBe(true);
      expect(isOrgAdmin(memberships, 'BUSINESS', 'shared-id')).toBe(false);
    });

    it('a plain MEMBER is not an admin', () => {
      // Membership lets you belong; only the ADMIN role lets you manage. A resident cannot
      // edit the contract or remove other residents.
      expect(isOrgAdmin([memberOf(APT_A)], 'APARTMENT', 'apt-a')).toBe(false);
    });

    it('is false for someone with no memberships at all', () => {
      expect(isOrgAdmin([], 'APARTMENT', 'apt-a')).toBe(false);
    });
  });

  describe('isOrgMember', () => {
    it('is true for both admins and plain members of the org', () => {
      expect(isOrgMember([adminOf(APT_A)], 'APARTMENT', 'apt-a')).toBe(true);
      expect(isOrgMember([memberOf(APT_A)], 'APARTMENT', 'apt-a')).toBe(true);
    });

    it('is false for a different org', () => {
      expect(isOrgMember([memberOf(APT_A)], 'APARTMENT', 'apt-b')).toBe(false);
    });
  });

  describe('assertOrgAdmin', () => {
    it('passes for the admin of the org', () => {
      expect(() => assertOrgAdmin([adminOf(BIZ_A)], 'BUSINESS', 'biz-a')).not.toThrow();
    });

    it('throws ORG_ACCESS_DENIED for another org — the adversarial case', () => {
      // The exact attack the phase's tests must cover: a real, authenticated org admin
      // reaching for a DIFFERENT org's data. It is a 403, and it names neither the target
      // org's existence nor its contents.
      expect(() => assertOrgAdmin([adminOf(APT_A)], 'APARTMENT', 'apt-b')).toThrow(
        OrgAccessDeniedError,
      );
    });

    it('throws for a member who is not the admin', () => {
      expect(() => assertOrgAdmin([memberOf(APT_A)], 'APARTMENT', 'apt-a')).toThrow(
        OrgAccessDeniedError,
      );
    });
  });

  describe('administeredOrgIds', () => {
    it('returns only the orgs the user ADMINISTERS, of the requested kind', () => {
      const memberships = [
        adminOf(APT_A),
        memberOf(APT_B), // member, not admin — must not appear
        adminOf(BIZ_A),
      ];

      // This set is what a list query is scoped by. A member-only org must not leak in, or a
      // resident would see their whole building's contracts.
      expect(administeredOrgIds(memberships, 'APARTMENT')).toEqual(['apt-a']);
      expect(administeredOrgIds(memberships, 'BUSINESS')).toEqual(['biz-a']);
    });

    it('returns empty when the user administers nothing', () => {
      expect(administeredOrgIds([memberOf(APT_A)], 'APARTMENT')).toEqual([]);
      expect(administeredOrgIds([], 'BUSINESS')).toEqual([]);
    });

    it('handles a user who administers several orgs of one kind', () => {
      const memberships = [adminOf(APT_A), adminOf(APT_B)];
      expect(administeredOrgIds(memberships, 'APARTMENT').sort()).toEqual(['apt-a', 'apt-b']);
    });
  });
});
