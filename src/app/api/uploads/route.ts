import { NextResponse, type NextRequest } from "next/server";

import { getAdminClient, getUserIdFromRequest } from "@/shared/api/supabaseAdmin";

export const runtime = "nodejs";

async function ensureBucket(bucketName: string) {
  const supabaseAdmin = getAdminClient();
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = buckets?.some((b: any) => b.name === bucketName);
  if (!exists) {
    await supabaseAdmin.storage.createBucket(bucketName, { public: false });
  }
}

export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabaseAdmin = getAdminClient();
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  const bucketName = "chat-attachments";
  await ensureBucket(bucketName);

  const fileName = `${userId}/${crypto.randomUUID()}-${file.name}`;
  const fileBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucketName)
    .upload(fileName, fileBuffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
    .from(bucketName)
    .createSignedUrl(fileName, 3600);

  if (signedUrlError) {
    return NextResponse.json({ error: signedUrlError.message }, { status: 500 });
  }

  return NextResponse.json({
    url: signedUrlData.signedUrl,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  });
}

