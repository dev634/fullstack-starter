import { getClient } from '@/actions/clients/clients';
import Title from '@/components/Title';
import { redirect } from 'next/navigation';

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
    <main className="flex flex-col justify-start items-center h-dvh overflow-y-auto pb-8">
      <Title title="Client Detail" />
      <p className='mb-2'>{client.data?.companyName}</p>
      <p className='mb-2'>{client.data?.firstName} {client.data?.lastName}</p>
      <p className='mb-2'>{client.data?.email}</p>
      <p className='mb-2'>{client.data?.address}</p>
      <p className='mb-2'>{client.data?.city}, {client.data?.zipCode}, {client.data?.country}</p>
    </main>
  )
}