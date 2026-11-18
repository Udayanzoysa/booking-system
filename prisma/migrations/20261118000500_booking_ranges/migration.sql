-- Combined booking ranges remain separate from the selectable schedule catalog.
ALTER TABLE "SlotSchedule" ADD COLUMN "isBookingRange" BOOLEAN NOT NULL DEFAULT false;
