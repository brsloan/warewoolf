var fakeFileSys = [
    {
      filename: "mobyDickProject.woolf",
      file: {
        title: "Moby Dick",
        author: "Herman Melville",
        notes: {"ops":[{"insert":"\tMore whale facts\n"}]},
        chapters: [
          {
            title: "Chapter One",
            filename: "0001.pup",
            filter: null,
            contents: null
          },
          {
            title: "Chapter Two",
            filename: "0002.pup",
            filter: null,
            contents: null
          },
          {
            title: "Chapter Three",
            filename: "0003.pup",
            filter: null,
            contents: null
          },
          {
            title: "Chapter Four",
            filename: "0004.pup",
            filter: null,
            contents: null
          }
        ],
        filters: [],
        trash: [
          {
            title: "Rejected Chapter",
            filename: "0005.pup",
            filter: null,
            contents: null
          }
        ],
        activeChapterIndex: 2
      }
    },
    {
      filename: "0001.pup",
      file: {"ops":[{"insert":"\tThis is the first chapter. Whales!\n"}]}
    },
    {
      filename: "0002.pup",
      file: {"ops":[{"insert":"\tThis is the second chapter. More whales!\n"}]}
    },
    {
      filename: "0003.pup",
      file: {"ops":[{"insert":"\tGODS but this is the third chapter. SO MANY WHALES!\n\tAnd here is another paragraph! FULL OF WHALES.\n"}]}
    },
    {
      filename: "0004.pup",
      file: {"ops":[{"insert":"\tBlister your lungs, man! This is chapter 4 and she be FULL of whales!\n"}]}
    },
    {
      filename: "0005.pup",
      file: {"ops":[{"insert":"\tPreviously rejhected chapter sitting int he trash\n"}]}
    },
    {
      filename: "6.pup",
      file: {"ops":[{"insert":"\tPreviously rejhected chapter sitting int he trash\n"}]}
    }
    
  ];