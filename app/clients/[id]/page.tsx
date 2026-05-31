import { getClient } from '@/actions/clients/clients';
import Title from '@/components/Title';
import Link from 'next/link';
import DeleteClientButton from './_components/DeleteClientButton';

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ClientPage({ params }: PageProps) {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  const client = await getClient(clientId);
  const isError = client.type === "error";
  const isEmpty = client.type === "success" && !client.data

  if(isError){
    return (
    <main className="flex flex-col justify-start items-center h-dvh overflow-y-auto pb-8">
      <Title title="Client Detail" />
      <p className="text-red-500">{client.message}</p> 
    </main>
    )
  }

  if(isEmpty){
    return <main className="flex flex-col justify-start items-center h-dvh overflow-y-auto pb-8">
            <Title title="Client Detail" />
            <p>This client doesn't exists ...</p>
          </main>
  }
  
  return ( 
    <main className="flex flex-col justify-center items-center h-dvh overflow-y-auto pb-8">
      <Title title={`${client.data?.firstName} ${client.data?.lastName}`} />
      <p className='mb-2'>{client.data?.companyName}</p>
      <p className='mb-2'>{client.data?.email}</p>
      <p className='mb-2'>{client.data?.address}</p>
      <p className='mb-8'>{client.data?.city}, {client.data?.zipCode}, {client.data?.country}</p>
      <div className="flex w-80 justify-around">
        <Link className='w-30 bg-blue-400 px-4 py-2 rounded text-center hover:bg-blue-500' href={`/clients/${id}/edit`}>Modifier</Link>
        <DeleteClientButton clientId={client.data?.id || 0} />
      </div>
    </main>
  )
}