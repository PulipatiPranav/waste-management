import type { Schemas } from '@cpe/shared-types';

/**
 * Named aliases for the response/request shapes the console uses, all sourced from the generated
 * OpenAPI types. Importing from here (not re-declaring shapes by hand) is what keeps the admin in
 * lockstep with the API: rename a field in a NestJS DTO, regenerate, and every consumer of that
 * field here becomes a TypeScript error at build time.
 */

export type Session = Schemas['SessionResponseDto'];
export type UserProfile = Schemas['UserProfileDto'];
export type Role = UserProfile['role'];

// Wallet / finance
export type Wallet = Schemas['WalletDto'];
export type LedgerEntry = Schemas['LedgerEntryDto'];
export type Withdrawal = Schemas['WithdrawalDto'];
export type Reconciliation = Schemas['ReconciliationDto'];

// Delivery
export type Run = Schemas['RunDto'];
export type Stop = Schemas['StopDto'];
export type Partner = Schemas['PartnerDto'];
export type CompletionStats = Schemas['CompletionStatsDto'];

// Recycling
export type Batch = Schemas['BatchDto'];
export type ChainOfCustody = Schemas['ChainOfCustodyDto'];
export type Dispatch = Schemas['DispatchDto'];

// Orgs
export type OrgMember = Schemas['OrgMemberDto'];
export type Contract = Schemas['ContractDto'];
export type Invoice = Schemas['InvoiceDto'];

// Marketplace
export type Order = Schemas['OrderDto'];
export type Seller = Schemas['SellerDto'];
export type Product = Schemas['ProductDto'];

// Audit
export type AuditLog = Schemas['AuditLogDto'];
export type AuditPage = Schemas['AuditPageDto'];
