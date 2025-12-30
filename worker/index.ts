export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    // Handle API routes
    if (url.pathname === '/api/') {
      return Response.json({ name: 'Cloudflare' });
    }

    if (url.pathname === '/api/upload' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const imageFile = formData.get('image') as File;
        const metadata = JSON.parse(formData.get('metadata') as string);

        if (!imageFile) {
          return Response.json({ error: 'No image provided' }, { status: 400 });
        }

        const id = crypto.randomUUID();
        const filename = `${id}.png`;

        await env.IMAGES.put(filename, imageFile.stream(), {
          httpMetadata: {
            contentType: 'image/png',
          },
        });

        await env.DB.prepare(
          `INSERT INTO images (id, filename, original_width, original_height, crop_x, crop_y, crop_width, crop_height, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            filename,
            metadata.originalWidth,
            metadata.originalHeight,
            metadata.cropX,
            metadata.cropY,
            metadata.cropWidth,
            metadata.cropHeight,
            new Date().toISOString()
          )
          .run();

        return Response.json({ 
          success: true, 
          id, 
          filename,
          url: `/api/images/${id}`
        });
      } catch (error) {
        console.error('Upload error:', error);
        return Response.json({ error: 'Upload failed' }, { status: 500 });
      }
    }

    // Try to serve the asset
    const response = await env.ASSETS.fetch(request);
    
    // If it's a 404 and NOT a file request (no extension), serve index.html for client-side routing
    if (response.status === 404 && !url.pathname.includes('.')) {
      const indexRequest = new Request(new URL('/', url.origin), request);
      return env.ASSETS.fetch(indexRequest);
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
