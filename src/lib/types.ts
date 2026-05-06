export type Role = "participant" | "boothAdmin" | "rewardAdmin" | "superAdmin";

export type RewardId = "chemistry" | "biology" | "quasar" | "alphago";

export type Account = {
  id: string;
  loginId: string;
  loginIdLower: string;
  passwordHash: string;
  role: Role;
  displayName: string;
  studentCode?: string;
  participantCacheHash?: string;
  boothId?: string;
  rewardId?: RewardId;
  selectedRewardId?: RewardId;
  qrVersion: number;
  displayNameChangedAt?: string;
  displayNameChangeDay?: string;
  displayNameChangeCountToday?: number;
  disabled: boolean;
  createdAt: string;
  lastLoginAt?: string;
};

export type Session = {
  id: string;
  accountId: string;
  tokenHash: string;
  role: Role;
  deviceHash?: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  ipHash: string;
  userAgentHash: string;
};

export type AdminInviteCode = {
  id: string;
  codeLabel: string;
  codeHash: string;
  role: Exclude<Role, "participant">;
  boothId?: string;
  rewardId?: RewardId;
  used: boolean;
  usedCount?: number;
  usedByAccountId?: string;
  usedAt?: string;
  revoked: boolean;
  createdAt: string;
};

export type Booth = {
  id: string;
  name: string;
  clubName: string;
  adminAccountIds: string[];
  stampImageDataUrl?: string;
  stampDesignUpdatedAt?: string;
  active: boolean;
};

export type RewardItem = {
  id: RewardId;
  name: string;
  clubName: string;
  imagePath: string;
  active: boolean;
};

export type Stamp = {
  id: string;
  participantAccountId: string;
  boothId: string;
  boothName: string;
  stampImageDataUrl: string;
  issuedByAdminId: string;
  createdAt: string;
  voided: boolean;
};

export type Coupon = {
  id: string;
  participantAccountId: string;
  rewardId: RewardId;
  status: "unused" | "redeemed";
  createdAt: string;
  redeemedAt?: string;
  redeemedByAccountId?: string;
};

export type TempPassStamp = {
  boothId: string;
  boothName: string;
  stampImageDataUrl: string;
  issuedByAdminId: string;
  createdAt: string;
};

export type TempPass = {
  id: string;
  label: string;
  displayName?: string;
  qrVersion: number;
  status: "active" | "redeemed" | "voided";
  stamps: TempPassStamp[];
  issuedByAccountId: string;
  createdAt: string;
  redeemedAt?: string;
  redeemedByAccountId?: string;
  redeemedRewardId?: RewardId;
};

export type TeaReservation = {
  id: string;
  orderNumber: number;
  participantAccountId?: string;
  displayName: string;
  studentCode?: string;
  source: "online" | "manual" | "reward";
  status: "reserved" | "brewing" | "ready" | "served" | "cancelled";
  quantity: number;
  note?: string;
  serialCommand?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  readyAt?: string;
  servedAt?: string;
  cancelledAt?: string;
  handledByAccountId?: string;
  cancelledByAccountId?: string;
};

export type ClubNotice = {
  id: string;
  clubId: string;
  clubName: string;
  message: string;
  createdByAccountId: string;
  createdAt: string;
  revoked: boolean;
};

export type Profile = {
  accountId: string;
  nickname: string;
  bio: string;
  avatarStampId?: string;
  themeId: string;
  frameId: string;
  publicProfile: boolean;
  updatedAt: string;
};

export type UserStats = {
  accountId: string;
  stampCount: number;
  uniqueBoothCount: number;
  couponEligible: boolean;
  couponClaimed: boolean;
  firstStampAt?: string;
  lastStampAt?: string;
  completedSevenAt?: string;
};

export type NameChangeLog = {
  id: string;
  accountId: string;
  oldDisplayName: string;
  newDisplayName: string;
  changedAt: string;
  ipHash: string;
  userAgentHash: string;
};

export type AuditLog = {
  id: string;
  actorAccountId: string;
  action: string;
  targetId?: string;
  createdAt: string;
  ipHash: string;
  userAgentHash: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type LoginEvent = {
  id: string;
  accountId?: string;
  loginId: string;
  role?: Role;
  displayName?: string;
  result: "success" | "failed" | "blocked";
  reason?: string;
  deviceHash: string;
  ipHash: string;
  userAgentHash: string;
  userAgentSummary: string;
  createdAt: string;
};

export type DeviceBlock = {
  id: string;
  deviceHash: string;
  reason: string;
  accountIds: string[];
  loginIds: string[];
  active: boolean;
  createdAt: string;
  releasedAt?: string;
  releasedByAccountId?: string;
};

export type StampDb = {
  meta: {
    createdAt: string;
    updatedAt: string;
    version: number;
    defaultStampImageDataUrl?: string;
    defaultStampUpdatedAt?: string;
    arduinoFirmwareText?: string;
    arduinoFirmwareUpdatedAt?: string;
    arduinoFirmwareUpdatedByAccountId?: string;
    teaStockCount?: number;
    teaStockUpdatedAt?: string;
    teaStockUpdatedByAccountId?: string;
  };
  accounts: Account[];
  sessions: Session[];
  adminInviteCodes: AdminInviteCode[];
  booths: Booth[];
  rewards: RewardItem[];
  stamps: Stamp[];
  coupons: Coupon[];
  tempPasses: TempPass[];
  teaReservations: TeaReservation[];
  clubNotices: ClubNotice[];
  profiles: Profile[];
  userStats: UserStats[];
  nameChangeLogs: NameChangeLog[];
  auditLogs: AuditLog[];
  loginEvents: LoginEvent[];
  deviceBlocks: DeviceBlock[];
};
