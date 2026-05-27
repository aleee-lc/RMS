-- AlterTable: add email verification fields to User
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailVerificationToken" TEXT;

-- Mark all existing users as verified (they pre-date this migration)
UPDATE "User" SET "emailVerified" = true;

-- CreateIndex: unique verification token
CREATE UNIQUE INDEX "User_emailVerificationToken_key" ON "User"("emailVerificationToken");

-- CreateTable: HotelInviteCode
CREATE TABLE "HotelInviteCode" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "role" "HotelRole" NOT NULL DEFAULT 'VIEWER',
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "uses" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HotelInviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HotelInviteCode_code_key" ON "HotelInviteCode"("code");

-- CreateIndex
CREATE INDEX "HotelInviteCode_hotelId_idx" ON "HotelInviteCode"("hotelId");

-- AddForeignKey
ALTER TABLE "HotelInviteCode" ADD CONSTRAINT "HotelInviteCode_hotelId_fkey"
    FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
