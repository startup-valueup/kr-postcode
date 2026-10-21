import { getPermalink } from './utils/permalinks';

export const headerData = {
  links: [
    { text: '우편번호 검색', href: getPermalink('/search') },
    { text: '주소로 찾기', href: getPermalink('/address') },
    { text: '지역별', href: getPermalink('/sido') },
    { text: '데이터 안내', href: getPermalink('/data') },
  ],
  actions: [],
};

export const footerData = {
  links: [
    {
      title: '둘러보기',
      links: [
        { text: '우편번호 검색', href: getPermalink('/search') },
        { text: '주소로 찾기', href: getPermalink('/address') },
        { text: '지역별 우편번호', href: getPermalink('/sido') },
      ],
    },
    {
      title: '안내',
      links: [
        { text: '데이터 출처·기준일·한계', href: getPermalink('/data') },
      ],
    },
  ],
  secondaryLinks: [],
  socialLinks: [],
  footNote: `
    우편번호 데이터: 우체국 우편번호 DB · 국가기초구역 도형 · 개발 중 시험판입니다. 값은 참고용이며 공식 안내는 우체국 및 도로명주소 안내시스템을 확인하세요.
  `,
};
