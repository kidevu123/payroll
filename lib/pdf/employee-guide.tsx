// "Welcome to Milo" employee onboarding PDF. Distributable handout —
// owner: "build me a quick guide PDF that i can send to employees with
// screen shot". Five pages, brand-flavored, embeds screenshots when
// they exist on disk (otherwise renders placeholder boxes).
//
// Where the screenshots come from:
//   /data/employee-guide/<step>.png
// Suggested capture flow: run `pnpm screenshots <BASE_URL> <EMAIL> <PW>`
// and copy the relevant PNGs (me-home-mobile.png, me-pay-mobile.png,
// me-profile-mobile.png, me-time-mobile.png, install-sheet.png) into
// /data/employee-guide/. The renderer falls back to a tasteful
// placeholder when a file is missing so the PDF is always shippable.

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

export type EmployeeGuideInput = {
  company: { name: string; brandColorHex: string; logoPath?: string | null };
  /** Resolved absolute paths to screenshot PNGs (or null when missing). */
  screenshots: {
    install?: string | null;
    home?: string | null;
    pay?: string | null;
    time?: string | null;
    profile?: string | null;
  };
  /** Resolved app URL (e.g. https://payroll.acme.com) for the cover page. */
  appUrl: string;
  generatedAt: string;
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#0f172a",
    lineHeight: 1.5,
  },
  cover: {
    padding: 60,
    fontFamily: "Helvetica",
    color: "#0f172a",
    flexDirection: "column",
    justifyContent: "space-between",
    height: "100%",
  },
  coverHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  coverLogo: { width: 36, height: 36 },
  coverTitle: { fontSize: 32, fontFamily: "Helvetica-Bold", marginTop: 100 },
  coverSubtitle: {
    fontSize: 14,
    color: "#475569",
    marginTop: 10,
    maxWidth: "70%",
    lineHeight: 1.5,
  },
  coverFooter: {
    fontSize: 9,
    color: "#94a3b8",
    marginTop: "auto",
    lineHeight: 1.6,
  },
  brandBar: {
    height: 4,
    borderRadius: 2,
    width: 60,
    marginBottom: 20,
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  pageStep: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    color: "#94a3b8",
    textTransform: "uppercase",
  },
  pageTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  intro: {
    fontSize: 11,
    color: "#475569",
    marginBottom: 16,
  },
  steps: { gap: 10 },
  stepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  stepBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  stepText: { flex: 1, fontSize: 11 },
  stepStrong: { fontFamily: "Helvetica-Bold" },
  shotWrap: {
    marginTop: 18,
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    padding: 6,
    backgroundColor: "#f8fafc",
    alignItems: "center",
  },
  shot: { width: 240, height: 420 },
  shotPlaceholder: {
    width: 240,
    height: 420,
    backgroundColor: "#e2e8f0",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  shotPlaceholderLabel: {
    fontSize: 10,
    color: "#64748b",
    fontFamily: "Helvetica-Bold",
  },
  shotCaption: {
    marginTop: 6,
    fontSize: 9,
    color: "#64748b",
    textAlign: "center",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#94a3b8",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
    paddingTop: 8,
  },
});

function PlaceholderShot({ label }: { label: string }) {
  return (
    <View style={styles.shotPlaceholder}>
      <Text style={styles.shotPlaceholderLabel}>[{label}]</Text>
    </View>
  );
}

function Shot({
  src,
  fallback,
  caption,
}: {
  src: string | null | undefined;
  fallback: string;
  caption: string;
}) {
  return (
    <View style={styles.shotWrap}>
      {src ? (
        <Image src={src} style={styles.shot} />
      ) : (
        <PlaceholderShot label={fallback} />
      )}
      <Text style={styles.shotCaption}>{caption}</Text>
    </View>
  );
}

function Step({
  n,
  brand,
  children,
}: {
  n: number;
  brand: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepBadge, { backgroundColor: brand }]}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{children}</Text>
    </View>
  );
}

function Footer({ data, page }: { data: EmployeeGuideInput; page: number }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{data.company.name} — Employee guide</Text>
      <Text>Page {page}</Text>
    </View>
  );
}

export function EmployeeGuide({ data }: { data: EmployeeGuideInput }) {
  const brand = data.company.brandColorHex;
  return (
    <Document title={`${data.company.name} — Employee guide`}>
      {/* Cover */}
      <Page size="LETTER" style={styles.cover}>
        <View style={styles.coverHeader}>
          {data.company.logoPath ? (
            <Image src={data.company.logoPath} style={styles.coverLogo} />
          ) : null}
          <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: brand }}>
            {data.company.name}
          </Text>
        </View>
        <View>
          <View style={[styles.brandBar, { backgroundColor: brand }]} />
          <Text style={styles.coverTitle}>Welcome to Milo</Text>
          <Text style={styles.coverSubtitle}>
            Your hours, paystubs, and time-off requests in one place. This
            short guide walks you through getting set up on your phone in
            under two minutes.
          </Text>
        </View>
        <View style={styles.coverFooter}>
          <Text>Sign in at {data.appUrl}</Text>
          <Text>Use the email your manager set up for you.</Text>
          <Text style={{ marginTop: 6 }}>Generated {data.generatedAt}</Text>
        </View>
      </Page>

      {/* Step 1: Add to Home Screen */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageStep}>Step 1 of 4</Text>
          <Text style={[styles.pageStep, { color: brand }]}>~30 seconds</Text>
        </View>
        <Text style={styles.pageTitle}>Save Milo to your Home Screen</Text>
        <Text style={styles.intro}>
          Add Milo as an icon on your phone so you can open it like any other
          app — no typing the URL every time, no Safari window in the way.
        </Text>
        <View style={styles.steps}>
          <Step n={1} brand={brand}>
            Open Safari (iPhone) or Chrome (Android) and go to{" "}
            <Text style={styles.stepStrong}>{data.appUrl}</Text>.
          </Step>
          <Step n={2} brand={brand}>
            <Text style={styles.stepStrong}>iPhone:</Text> tap the Share
            button at the bottom of Safari, then{" "}
            <Text style={styles.stepStrong}>Add to Home Screen</Text>.
          </Step>
          <Step n={3} brand={brand}>
            <Text style={styles.stepStrong}>Android:</Text> tap the menu
            (three dots, top-right), then{" "}
            <Text style={styles.stepStrong}>Install app</Text> or{" "}
            <Text style={styles.stepStrong}>Add to Home Screen</Text>.
          </Step>
          <Step n={4} brand={brand}>
            Tap <Text style={styles.stepStrong}>Add</Text>. Milo lands on
            your Home Screen — open it from there from now on.
          </Step>
        </View>
        <Shot
          src={data.screenshots.install}
          fallback="Add to Home Screen sheet"
          caption="The Add to Home Screen sheet inside Milo"
        />
        <Footer data={data} page={1} />
      </Page>

      {/* Step 2: View hours + paystubs */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageStep}>Step 2 of 4</Text>
          <Text style={[styles.pageStep, { color: brand }]}>The basics</Text>
        </View>
        <Text style={styles.pageTitle}>Your hours and paystubs</Text>
        <Text style={styles.intro}>
          The bottom nav has five tabs. Home shows this week at a glance.
          Time shows your daily punches. Pay lists every payslip with the
          amount and the PDF.
        </Text>
        <View style={styles.steps}>
          <Step n={1} brand={brand}>
            Open the <Text style={styles.stepStrong}>Home</Text> tab to see
            your hours so far this week and your latest payslip.
          </Step>
          <Step n={2} brand={brand}>
            Open the <Text style={styles.stepStrong}>Pay</Text> tab. Each
            card is a pay period. Tap a card to see the breakdown by day or
            download the PDF paystub.
          </Step>
          <Step n={3} brand={brand}>
            On the <Text style={styles.stepStrong}>Time</Text> tab, today is
            on top. Below it is the rest of the week. Yellow means a punch
            is missing.
          </Step>
        </View>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 14 }}>
          <Shot src={data.screenshots.home} fallback="Home tab" caption="Home" />
          <Shot src={data.screenshots.pay} fallback="Pay tab" caption="Pay" />
          <Shot src={data.screenshots.time} fallback="Time tab" caption="Time" />
        </View>
        <Footer data={data} page={2} />
      </Page>

      {/* Step 3: Time off */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageStep}>Step 3 of 4</Text>
          <Text style={[styles.pageStep, { color: brand }]}>When you need a day off</Text>
        </View>
        <Text style={styles.pageTitle}>Request time off</Text>
        <Text style={styles.intro}>
          Submit time-off requests right from the app. Your manager gets a
          notification immediately and approves or follows up. Approved
          time-off shows up on the Calendar tab so your colleagues can see
          who&apos;s out.
        </Text>
        <View style={styles.steps}>
          <Step n={1} brand={brand}>
            On the <Text style={styles.stepStrong}>Home</Text> tab tap{" "}
            <Text style={styles.stepStrong}>Request time off</Text>.
          </Step>
          <Step n={2} brand={brand}>
            Pick the start and end date. Pick a type — Sick, Personal,
            Unpaid, Other. Add a note if you want.
          </Step>
          <Step n={3} brand={brand}>
            Tap <Text style={styles.stepStrong}>Submit</Text>. You&apos;ll get a
            notification when it&apos;s approved or rejected.
          </Step>
          <Step n={4} brand={brand}>
            Open the <Text style={styles.stepStrong}>Calendar</Text> tab to
            see who else is off this week.
          </Step>
        </View>
        <Footer data={data} page={3} />
      </Page>

      {/* Step 4: Missed punches + profile */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageStep}>Step 4 of 4</Text>
          <Text style={[styles.pageStep, { color: brand }]}>Fix-its and finishing touches</Text>
        </View>
        <Text style={styles.pageTitle}>Missed punches and your profile</Text>
        <Text style={styles.intro}>
          If you forgot to clock in or out, fix it right from the app. While
          you&apos;re there, drop your birthday into your profile so the team
          can wish you happy birthday.
        </Text>
        <View style={styles.steps}>
          <Step n={1} brand={brand}>
            On the <Text style={styles.stepStrong}>Home</Text> tab tap{" "}
            <Text style={styles.stepStrong}>Report a missed punch</Text>.
            Pick the date and tell us what time you actually came in or
            left. Your manager confirms and the day is fixed.
          </Step>
          <Step n={2} brand={brand}>
            Open the <Text style={styles.stepStrong}>Profile</Text> tab.
            Update your phone number, your preferred display name, and add
            your <Text style={styles.stepStrong}>Birthday</Text> if you&apos;d like.
          </Step>
          <Step n={3} brand={brand}>
            On Profile tap <Text style={styles.stepStrong}>Enable
            notifications</Text> so you get a ping the moment a payslip
            publishes or a time-off request is approved.
          </Step>
          <Step n={4} brand={brand}>
            Use <Text style={styles.stepStrong}>Sign out</Text> on a
            shared device. Your data is safe — it&apos;s all on the server.
          </Step>
        </View>
        <Shot
          src={data.screenshots.profile}
          fallback="Profile tab"
          caption="Your profile"
        />
        <Footer data={data} page={4} />
      </Page>
    </Document>
  );
}
