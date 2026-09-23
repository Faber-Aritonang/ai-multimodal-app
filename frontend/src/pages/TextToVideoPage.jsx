import VideoTool from '../components/VideoTool'

/**
 * Text to Video — halaman tipis di atas kerangka bersama VideoTool.
 *
 * Seluruh perilakunya (form, polling pekerjaan latar belakang, panel hasil,
 * riwayat) ada di komponen itu; yang di sini hanya teks dan endpointnya, supaya
 * halaman ini dan Image to Video tidak pernah menyimpang satu sama lain.
 */
const TextToVideoPage = ({ user, setUser }) => (
  <VideoTool
    user={user}
    setUser={setUser}
    type="text-to-video"
    eyebrow="alat 05 · video"
    title="Text to Video"
    description="Tuliskan adegan yang Anda inginkan, lalu tunggu beberapa menit — videonya dibuat di server dan muncul sendiri di halaman ini."
    promptPlaceholder="A slow cinematic push-in on a neon-lit street market at night, rain on the pavement"
    emptyHistory="No videos yet. Describe a scene above to make your first one."
  />
)

export default TextToVideoPage
