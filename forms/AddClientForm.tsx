export default function AddClientForm() {
  return (
    <form className="w-full p-4 bg-gray-300 rounded shadow">
      <input type="text" placeholder="Firstname" className="w-full mb-4 p-2 border rounded text-black bg-white" />
      <input type="text" placeholder="Lastname" className="w-full mb-4 p-2 border rounded text-black bg-white" />
      <input type="email" placeholder="Email" className="w-full mb-4 p-2 border rounded text-black bg-white" />
      <input type="text" placeholder="Company Name" className="w-full mb-4 p-2 border rounded text-black bg-white" />
      <input type="text" placeholder="City" className="w-full mb-4 p-2 border rounded text-black bg-white" />
      <input type="text" placeholder="Zip code" className="w-full mb-4 p-2 border rounded text-black bg-white" />
    </form>
  );
}   