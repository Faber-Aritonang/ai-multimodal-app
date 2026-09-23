import VideoTool from '../components/VideoTool'

/**
 * Image to Video — halaman tipis di atas kerangka bersama VideoTool.
 *
 * Bedanya dari Text to Video hanya satu: `requiresImage` menyalakan kotak
 * unggah, dan endpoint yang dipanggil menjadi POST /media/image-to-video.
 * Gambar yang diunggah menjadi frame PERTAMA video, jadi gerakan yang diminta
 * harus masuk akal dari komposisi gambar itu.
 */
const ImageToVideoPage = ({ user, setUser }) => (
  <VideoTool
    user={user}
    setUser={setUser}
    type="image-to-video"
    requiresImage
    eyebrow="alat 06 · video"
    title="Image to Video"
    description="Unggah satu gambar sebagai frame pertama, tuliskan gerakan yang Anda inginkan, lalu tunggu videonya selesai dibuat."
    promptPlaceholder="The camera slowly zooms in while the clouds drift and light shifts across the scene"
    emptyHistory="No videos yet. Upload a picture above to animate it."
  />
)

export default ImageToVideoPage
