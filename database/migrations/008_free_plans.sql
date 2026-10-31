/* 008 — "Free for now" launch mode.
   The Super Admin can make any priced plan FREE for a while: the website then shows a "free for now" banner and new
   hospitals register without paying (a full, isolated workspace is created exactly like a paid sign-up).
   When charging starts again, free hospitals get a notice period and are then asked to pay through the normal
   renewal flow. Schema: hms. */

ALTER TABLE hms.Plans ADD
    IsFree    BIT NOT NULL CONSTRAINT DF_Plans_IsFree DEFAULT (0),
    FreeSince DATETIME2(3) NULL;

/* Marks subscriptions that were started or extended without payment while the plan was free. */
ALTER TABLE hms.Subscriptions ADD
    IsFree BIT NOT NULL CONSTRAINT DF_Subscriptions_IsFree DEFAULT (0);
GO

/* A contact-sales plan is never free (it has no self-service sign-up). */
ALTER TABLE hms.Plans ADD CONSTRAINT CK_Plans_FreeNotContactSales CHECK (NOT (IsFree = 1 AND IsContactSales = 1));
