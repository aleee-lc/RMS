CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');
CREATE TYPE "HotelRole" AS ENUM ('OWNER', 'MANAGER', 'ANALYST', 'VIEWER');

CREATE TABLE "User" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "HotelMembership" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "hotelId" INTEGER NOT NULL,
  "role" "HotelRole" NOT NULL DEFAULT 'VIEWER',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HotelMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HotelMembership_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE UNIQUE INDEX "HotelMembership_userId_hotelId_key" ON "HotelMembership"("userId", "hotelId");
CREATE INDEX "HotelMembership_hotelId_idx" ON "HotelMembership"("hotelId");
CREATE INDEX "HotelMembership_userId_isDefault_idx" ON "HotelMembership"("userId", "isDefault");
