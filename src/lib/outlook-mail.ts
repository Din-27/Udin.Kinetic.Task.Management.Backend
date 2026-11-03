export interface OutlookEmailMessage {
  id: string;
  subject: string;
  senderEmail: string;
  senderName: string;
  receivedDateTime: string;
  bodyPreview: string;
  bodyContent: string;
}

export async function fetchOutlookEmails(options: {
  memberEmails: string[];
  accessToken?: string;
}): Promise<OutlookEmailMessage[]> {
  const { memberEmails, accessToken } = options;

  // 1. Jika ada access token Microsoft Graph yang valid, panggil Graph API
  if (accessToken) {
    try {
      const res = await fetch(
        "https://graph.microsoft.com/v1.0/me/messages?$top=30&$select=id,subject,from,receivedDateTime,bodyPreview,body&$orderby=receivedDateTime desc",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        },
      );

      if (res.ok) {
        const data = await res.json();
        const messages: OutlookEmailMessage[] = (data.value || []).map(
          (item: any) => ({
            id: item.id,
            subject: item.subject || "(Tanpa Subjek)",
            senderEmail: item.from?.emailAddress?.address || "",
            senderName: item.from?.emailAddress?.name || "Unknown Sender",
            receivedDateTime: item.receivedDateTime || new Date().toISOString(),
            bodyPreview: item.bodyPreview || "",
            bodyContent: item.body?.content || item.bodyPreview || "",
          }),
        );

        if (memberEmails.length > 0) {
          const lowerMembers = memberEmails.map((e) => e.toLowerCase());
          const filtered = messages.filter((m) =>
            lowerMembers.includes(m.senderEmail.toLowerCase()),
          );
          if (filtered.length > 0) return filtered;
        }
        return messages;
      }
    } catch (err) {
      console.warn(
        "Gagal menghubungi Microsoft Graph API, menggunakan fallback dev:",
        err,
      );
    }
  }

  // 2. Fallback Simulator Inbox untuk Development & Demo
  const activeMembers =
    memberEmails.length > 0
      ? memberEmails
      : [
          "ahmad.syarif@kinetic.id",
          "siti.rahma@kinetic.id",
          "budi.pratama@kinetic.id",
        ];

  const member1 = activeMembers[0] || "ahmad.syarif@kinetic.id";
  const member2 = activeMembers[1] || "siti.rahma@kinetic.id";
  const member3 = activeMembers[2] || "budi.pratama@kinetic.id";

  const simulatedEmails: OutlookEmailMessage[] = [];

  return simulatedEmails;
}
